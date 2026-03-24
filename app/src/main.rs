#![windows_subsystem = "windows"]
#![allow(dead_code)]
#![allow(unused_imports)]

use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use tao::{
    dpi::{LogicalPosition, LogicalSize},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop, EventLoopBuilder},
    window::{Window, WindowBuilder},
};
use wry::{WebViewBuilder, WebContext};
use serde::{Deserialize, Serialize};

mod ipc;
mod bridge;

use bridge::core::dynamic_plugin_loader::WebArcadeConfig;
mod plugin_installer;

#[derive(Debug, Serialize)]
pub struct IpcResponse {
    pub id: u64,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl IpcResponse {
    pub fn ok(id: u64, data: impl Serialize) -> Self {
        Self {
            id,
            success: true,
            data: Some(serde_json::to_value(data).unwrap_or(serde_json::Value::Null)),
            error: None,
        }
    }

    pub fn ok_empty(id: u64) -> Self {
        Self {
            id,
            success: true,
            data: None,
            error: None,
        }
    }

    pub fn err(id: u64, msg: impl Into<String>) -> Self {
        Self {
            id,
            success: false,
            data: None,
            error: Some(msg.into()),
        }
    }
}

#[derive(Debug, Deserialize)]
struct IpcRequest {
    id: u64,
    command: String,
    #[serde(default)]
    args: serde_json::Value,
}

// Custom event for IPC responses
#[derive(Debug)]
enum UserEvent {
    IpcResponse(String),
}

fn main() {
    // Initialize logger
    let _ = env_logger::Builder::from_default_env()
        .format_timestamp_secs()
        .try_init();

    log::info!("WebArcade starting...");

    // Load config to get window size
    let config = load_config();
    let (width, height) = (config.width as f64, config.height as f64);
    let title = config.name.clone();

    // Start the bridge server in background
    start_bridge_server();

    let event_loop: EventLoop<UserEvent> = EventLoopBuilder::with_user_event().build();
    let proxy = event_loop.create_proxy();

    // Create borderless window
    let window = WindowBuilder::new()
        .with_title(&title)
        .with_inner_size(LogicalSize::new(width, height))
        .with_min_inner_size(LogicalSize::new(800.0, 600.0))
        .with_decorations(false)
        .build(&event_loop)
        .expect("Failed to create window");

    let window = Arc::new(window);
    let window_for_ipc = window.clone();

    // Get WebView2 data directory in AppData (avoids Program Files permission issues)
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(env!("CARGO_PKG_NAME"));

    // Clear WebView2 cache to ensure fresh content loads
    // This fixes the issue where old cached content is shown after rebuilds
    let cache_dir = data_dir.join("EBWebView").join("Default").join("Cache");
    if cache_dir.exists() {
        let _ = std::fs::remove_dir_all(&cache_dir);
        log::info!("Cleared WebView2 cache");
    }

    // Create web context with custom data directory
    let mut web_context = WebContext::new(Some(data_dir));

    // Create webview with IPC handler and custom protocols
    let webview = WebViewBuilder::with_web_context(&mut web_context)
        // Custom protocol: app:// - serves static files AND project assets
        // Priority:
        // 1. Try dist/ first (for app JS/CSS/HTML including dist/assets/)
        // 2. For /project-assets/* route to ASSETS_ROOT (for 3D models, textures)
        .with_custom_protocol("app".into(), |_webview, request| {
            let path = request.uri().path();

            // Route /project-assets/* to project asset file serving (ASSETS_ROOT)
            if path.starts_with("/project-assets/") {
                let asset_path = &path[16..]; // Strip "/project-assets"
                match bridge::protocols::serve_asset_file(asset_path) {
                    Some((content, mime_type)) => {
                        return wry::http::Response::builder()
                            .status(200)
                            .header("Content-Type", mime_type)
                            .header("Access-Control-Allow-Origin", "*")
                            .body(content.into())
                            .unwrap();
                    }
                    None => {
                        return wry::http::Response::builder()
                            .status(404)
                            .header("Content-Type", "text/plain")
                            .body("Asset not found".as_bytes().to_vec().into())
                            .unwrap();
                    }
                }
            }

            // Everything else: serve from dist/ static files (includes /assets/app.js, etc.)
            match bridge::protocols::serve_app_file(path) {
                Some((content, mime_type)) => {
                    wry::http::Response::builder()
                        .status(200)
                        .header("Content-Type", mime_type)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(content.into())
                        .unwrap()
                }
                None => {
                    wry::http::Response::builder()
                        .status(404)
                        .header("Content-Type", "text/plain")
                        .body("Not found".as_bytes().to_vec().into())
                        .unwrap()
                }
            }
        })
        .with_ipc_handler(move |message| {
            let message_str = message.body();
            log::debug!("IPC message received: {}", message_str);

            // Parse the IPC request
            match serde_json::from_str::<IpcRequest>(message_str) {
                Ok(request) => {
                    let response = handle_ipc_command(&request, &window_for_ipc);
                    let response_json = serde_json::to_string(&response).unwrap_or_default();
                    let _ = proxy.send_event(UserEvent::IpcResponse(response_json));
                }
                Err(e) => {
                    log::error!("Failed to parse IPC request: {}", e);
                    let response = IpcResponse::err(0, format!("Invalid request: {}", e));
                    let response_json = serde_json::to_string(&response).unwrap_or_default();
                    let _ = proxy.send_event(UserEvent::IpcResponse(response_json));
                }
            }
        })
        .with_url(get_webview_url())
        .with_devtools(true)
        // Set desktop mode flag and include IPC bridge
        .with_initialization_script(r#"
            window.__WEBARCADE_DESKTOP__ = true;
        "#)
        .with_initialization_script(include_str!("ipc_bridge.js"))
        .build(&window)
        .expect("Failed to create webview");

    // Store webview for sending responses
    let webview = Arc::new(Mutex::new(webview));
    let webview_for_events = webview.clone();

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::UserEvent(UserEvent::IpcResponse(response_json)) => {
                // Send response back to JavaScript
                if let Ok(wv) = webview_for_events.lock() {
                    let script = format!("window.__WEBARCADE_IPC_CALLBACK__({})", response_json);
                    let _ = wv.evaluate_script(&script);
                }
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                *control_flow = ControlFlow::Exit;
            }
            _ => {}
        }
    });
}

fn get_webview_url() -> &'static str {
    // Use custom app:// protocol for serving static files
    // This bypasses HTTP entirely for better performance
    "app://localhost/"
}

fn handle_ipc_command(request: &IpcRequest, window: &Window) -> IpcResponse {
    let id = request.id;
    let args = &request.args;

    match request.command.as_str() {
        "ping" => IpcResponse::ok(id, "pong"),

        "close" => {
            std::process::exit(0);
        }

        "minimize" => {
            window.set_minimized(true);
            IpcResponse::ok_empty(id)
        }

        "maximize" => {
            window.set_maximized(true);
            IpcResponse::ok_empty(id)
        }

        "unmaximize" => {
            window.set_maximized(false);
            IpcResponse::ok_empty(id)
        }

        "toggleMaximize" => {
            window.set_maximized(!window.is_maximized());
            IpcResponse::ok_empty(id)
        }

        "fullscreen" => {
            let enabled = args.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
            if enabled {
                window.set_fullscreen(Some(tao::window::Fullscreen::Borderless(None)));
            } else {
                window.set_fullscreen(None);
            }
            IpcResponse::ok_empty(id)
        }

        "setSize" => {
            let width = args.get("width").and_then(|v| v.as_f64()).unwrap_or(800.0);
            let height = args.get("height").and_then(|v| v.as_f64()).unwrap_or(600.0);
            window.set_inner_size(LogicalSize::new(width, height));
            IpcResponse::ok_empty(id)
        }

        "getSize" => {
            let size = window.inner_size();
            IpcResponse::ok(id, serde_json::json!({
                "width": size.width,
                "height": size.height
            }))
        }

        "setPosition" => {
            let x = args.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let y = args.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
            window.set_outer_position(LogicalPosition::new(x, y));
            IpcResponse::ok_empty(id)
        }

        "getPosition" => {
            let pos = window.outer_position().unwrap_or(tao::dpi::PhysicalPosition::new(0, 0));
            IpcResponse::ok(id, serde_json::json!({
                "x": pos.x,
                "y": pos.y
            }))
        }

        "setMinSize" => {
            let width = args.get("width").and_then(|v| v.as_f64()).unwrap_or(400.0);
            let height = args.get("height").and_then(|v| v.as_f64()).unwrap_or(300.0);
            window.set_min_inner_size(Some(LogicalSize::new(width, height)));
            IpcResponse::ok_empty(id)
        }

        "setMaxSize" => {
            let width = args.get("width").and_then(|v| v.as_f64());
            let height = args.get("height").and_then(|v| v.as_f64());
            match (width, height) {
                (Some(w), Some(h)) => window.set_max_inner_size(Some(LogicalSize::new(w, h))),
                _ => window.set_max_inner_size(None::<LogicalSize<f64>>),
            }
            IpcResponse::ok_empty(id)
        }

        "center" => {
            if let Some(monitor) = window.current_monitor() {
                let screen_size = monitor.size();
                let window_size = window.outer_size();
                let x = (screen_size.width as i32 - window_size.width as i32) / 2;
                let y = (screen_size.height as i32 - window_size.height as i32) / 2;
                window.set_outer_position(tao::dpi::PhysicalPosition::new(x, y));
            }
            IpcResponse::ok_empty(id)
        }

        "setTitle" => {
            let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("WebArcade");
            window.set_title(title);
            IpcResponse::ok_empty(id)
        }

        "startDrag" => {
            let _ = window.drag_window();
            IpcResponse::ok_empty(id)
        }

        "isMaximized" => {
            IpcResponse::ok(id, window.is_maximized())
        }

        _ => IpcResponse::err(id, format!("Unknown command: {}", request.command))
    }
}

/// Start the bridge server in a background thread
fn start_bridge_server() {
    log::info!("[BRIDGE] Starting integrated bridge server...");

    std::thread::spawn(|| {
        let runtime = match tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .enable_all()
            .thread_name("bridge-worker")
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                log::error!("Failed to create tokio runtime: {}", e);
                return;
            }
        };

        runtime.block_on(async {
            log::info!("[BRIDGE] Tokio runtime created");

            match bridge::run_server().await {
                Ok(_) => log::info!("[BRIDGE] Server stopped"),
                Err(e) => log::error!("[BRIDGE ERROR] {}", e),
            }
        });
    });
}

/// Load the webarcade config file
fn load_config() -> WebArcadeConfig {
    // Try to find config in standard locations
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    let config_paths = [
        // Development: repo root (parent of app/)
        exe_dir.as_ref()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .map(|p| p.join("webarcade.config.json")),
        // Production: next to executable
        exe_dir.as_ref().map(|p| p.join("webarcade.config.json")),
        // Current working directory
        Some(PathBuf::from("webarcade.config.json")),
    ];

    for path in config_paths.iter().flatten() {
        if path.exists() {
            log::info!("Loading config from: {:?}", path);
            match WebArcadeConfig::load(path) {
                Ok(config) => return config,
                Err(e) => log::warn!("Failed to load config from {:?}: {}", path, e),
            }
        }
    }

    log::info!("No config found, using defaults");
    // Return defaults if no config found
    WebArcadeConfig {
        name: "WebArcade".to_string(),
        version: "1.0.0".to_string(),
        default_layout: None,
        width: 1280,
        height: 720,
        plugins: std::collections::HashMap::new(),
    }
}
