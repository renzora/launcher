#![allow(dead_code)]
#![allow(unused_variables)]

pub mod modules;
pub mod core;
pub mod protocols;

use std::env;
use std::net::SocketAddr;
use std::sync::Arc;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use log::{info, error};
use anyhow::Result;
use hyper::{Request, Response, StatusCode, body::Incoming};
use hyper::body::Bytes;
use http_body_util::{Full, combinators::BoxBody, BodyExt};
use std::convert::Infallible;

use crate::bridge::core::{EventBus, WebSocketBridge, RouterRegistry, DynamicPluginLoader};
use crate::bridge::core::dynamic_plugin_loader::PluginInfo;
use std::path::PathBuf;
use std::sync::{Mutex, RwLock};
use once_cell::sync::Lazy;
use include_dir::{include_dir, Dir};

/// Embed the dist folder at compile time
static DIST_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/dist");

/// Global registry of loaded plugins
pub static LOADED_PLUGINS: Lazy<Mutex<Vec<PluginInfo>>> = Lazy::new(|| Mutex::new(Vec::new()));

/// Global assets root directory (set by plugins dynamically)
pub static ASSETS_ROOT: Lazy<RwLock<PathBuf>> = Lazy::new(|| RwLock::new(PathBuf::new()));

/// Get the current assets root directory
pub fn get_assets_root() -> Option<PathBuf> {
    let path = ASSETS_ROOT.read().ok()?;
    if path.as_os_str().is_empty() {
        None
    } else {
        Some(path.clone())
    }
}

/// Set the assets root directory
pub fn set_assets_root(path: PathBuf) {
    if let Ok(mut root) = ASSETS_ROOT.write() {
        log::info!("[Bridge] Setting assets root to: {:?}", path);
        *root = path;
    }
}

/// Get the config JSON as a string (for use by protocols)
pub fn get_config_json() -> Option<String> {
    let plugins_dir = get_plugins_dir();
    let config_path = plugins_dir
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("webarcade.config.json"))
        .unwrap_or_else(|| plugins_dir.join("../webarcade.config.json"));

    std::fs::read_to_string(&config_path).ok()
}

/// Get the plugins directory based on environment
/// - Development: {app}/plugins (built plugins in app folder)
/// - Production: {exe_dir}/plugins (next to the executable)
fn get_plugins_dir() -> PathBuf {
    let exe_path = std::env::current_exe().ok();
    let exe_dir = exe_path.as_ref()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    // Check if we're running from target/release or target/debug
    let in_target = exe_path.as_ref()
        .and_then(|p| p.to_str())
        .map(|s| s.contains("target\\debug") || s.contains("target/debug") || s.contains("target\\release") || s.contains("target/release"))
        .unwrap_or(false);

    if in_target {
        // Running from app/target/release - use app/plugins
        // Path: webarcade/app/target/release/webarcade.exe -> webarcade/app/plugins
        if let Some(exe) = &exe_path {
            if let Some(release_dir) = exe.parent() {        // release/
                if let Some(target_dir) = release_dir.parent() { // target/
                    if let Some(app_dir) = target_dir.parent() { // app/
                        let plugins_dir = app_dir.join("plugins");
                        if plugins_dir.exists() || std::fs::create_dir_all(&plugins_dir).is_ok() {
                            log::info!("📁 Loading plugins from {:?}", plugins_dir);
                            return plugins_dir;
                        }
                    }
                }
            }
        }
    }

    // Production: plugins folder next to executable
    let plugins_dir = exe_dir.unwrap_or_default().join("plugins");
    log::info!("📁 Loading plugins from {:?}", plugins_dir);
    plugins_dir
}

/// Start the WebArcade bridge server
pub async fn run_server() -> Result<()> {
    // Initialize logger with timestamp (use try_init to avoid panic if already initialized)
    let _ = env_logger::Builder::from_default_env()
        .format_timestamp_secs()
        .try_init();

    info!("🎮 WebArcade Bridge - Plugin System v2.0");
    info!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Get configuration
    // Static files are served on port 3000 (FILE_PORT)
    // Bridge API is served on port 3001 (BRIDGE_PORT)
    let file_port = env::var("FILE_PORT").unwrap_or_else(|_| "3000".to_string());
    let bridge_port = env::var("BRIDGE_PORT").unwrap_or_else(|_| "3001".to_string());
    let ws_port = env::var("WS_PORT").unwrap_or_else(|_| "3002".to_string());

    // Initialize core systems
    info!("📦 Initializing core systems...");

    let event_bus = Arc::new(EventBus::new());

    // Create router registry
    let router_registry = RouterRegistry::new();

    // Set global router registry for dynamic plugin registration
    crate::bridge::core::plugin_exports::set_global_router_registry(router_registry.clone_registry());

    // Load dynamic (runtime) plugins
    info!("📦 Loading dynamic plugins...");
    let plugins_dir = get_plugins_dir();

    let mut dynamic_loader = DynamicPluginLoader::new(plugins_dir.clone());

    match dynamic_loader.load_all_plugins() {
        Ok(dynamic_plugins) => {
            info!("✅ Discovered {} dynamic plugins", dynamic_plugins.len());

            // Store loaded plugins in global state for API access
            {
                let mut loaded = LOADED_PLUGINS.lock().unwrap();
                *loaded = dynamic_plugins.clone();
            }

            // Register dynamic plugin routes
            for plugin_info in &dynamic_plugins {
                info!("   - {} (backend: {}, frontend: {})",
                    plugin_info.id,
                    plugin_info.has_backend,
                    plugin_info.has_frontend
                );

                // Register routes from routes.json
                if !plugin_info.routes.is_empty() {
                    info!("     └─ Registering {} routes", plugin_info.routes.len());

                    // Create a router for this plugin
                    let mut plugin_router = crate::bridge::core::PluginRouter::new();

                    for route in &plugin_info.routes {
                        if let (Some(method_str), Some(path), Some(handler_name)) = (
                            route.get("method").and_then(|v| v.as_str()),
                            route.get("path").and_then(|v| v.as_str()),
                            route.get("handler").and_then(|v| v.as_str()),
                        ) {
                            // Parse HTTP method
                            let method = match method_str {
                                "GET" => hyper::Method::GET,
                                "POST" => hyper::Method::POST,
                                "PUT" => hyper::Method::PUT,
                                "DELETE" => hyper::Method::DELETE,
                                "PATCH" => hyper::Method::PATCH,
                                _ => {
                                    error!("Unknown HTTP method: {}", method_str);
                                    continue;
                                }
                            };

                            let plugin_id = plugin_info.id.clone();
                            let handler_name_owned = handler_name.to_string();

                            // Clone route_path for path parameter extraction
                            let route_pattern = path.to_string();

                            // Create a handler that will call the DLL function
                            plugin_router.route(method, path, move |path_arg, query, req| {
                                let plugin_id = plugin_id.clone();
                                let handler_name = handler_name_owned.clone();
                                let route_pattern = route_pattern.clone();

                                Box::pin(async move {
                                    use http_body_util::Full;
                                    use hyper::body::Bytes;
                                    use http_body_util::combinators::BoxBody;
                                    use http_body_util::BodyExt;
                                    use std::collections::HashMap;

                                    // Extract method before consuming request
                                    let method_str = req.method().to_string();

                                    // Extract headers before consuming request
                                    let mut headers_map: HashMap<String, String> = HashMap::new();
                                    for (key, value) in req.headers().iter() {
                                        if let Ok(v) = value.to_str() {
                                            headers_map.insert(key.to_string(), v.to_string());
                                        }
                                    }

                                    // Collect the request body
                                    let body_bytes = match req.collect().await {
                                        Ok(collected) => collected.to_bytes(),
                                        Err(e) => {
                                            let error_json = serde_json::json!({
                                                "error": format!("Failed to read request body: {}", e)
                                            }).to_string();
                                            return hyper::Response::builder()
                                                .status(400)
                                                .header("Content-Type", "application/json")
                                                .header("Access-Control-Allow-Origin", "*")
                                                .body(BoxBody::new(Full::new(Bytes::from(error_json))))
                                                .unwrap();
                                        }
                                    };

                                    // Parse query string into key-value pairs
                                    let query_params: HashMap<String, String> = query
                                        .split('&')
                                        .filter(|s| !s.is_empty())
                                        .filter_map(|pair| {
                                            let mut parts = pair.splitn(2, '=');
                                            match (parts.next(), parts.next()) {
                                                (Some(k), Some(v)) => Some((
                                                    urlencoding::decode(k).unwrap_or_default().into_owned(),
                                                    urlencoding::decode(v).unwrap_or_default().into_owned()
                                                )),
                                                (Some(k), None) => Some((
                                                    urlencoding::decode(k).unwrap_or_default().into_owned(),
                                                    String::new()
                                                )),
                                                _ => None
                                            }
                                        })
                                        .collect();

                                    // Extract path parameters (e.g., /user/:id -> {"id": "123"})
                                    let path_params: HashMap<String, String> = {
                                        let pattern_parts: Vec<&str> = route_pattern.split('/').collect();
                                        let path_parts: Vec<&str> = path_arg.split('/').collect();
                                        let mut params = HashMap::new();

                                        if pattern_parts.len() == path_parts.len() {
                                            for (pattern_part, path_part) in pattern_parts.iter().zip(path_parts.iter()) {
                                                if pattern_part.starts_with(':') {
                                                    let param_name = &pattern_part[1..];
                                                    params.insert(param_name.to_string(), path_part.to_string());
                                                }
                                            }
                                        }
                                        params
                                    };

                                    // Build full HTTP context as JSON
                                    let request_context = serde_json::json!({
                                        "method": method_str,
                                        "path": path_arg,
                                        "query": query_params,
                                        "path_params": path_params,
                                        "headers": headers_map,
                                        "body": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &body_bytes),
                                        "body_len": body_bytes.len()
                                    });

                                    // Log request being sent to DLL (for debugging)
                                    log::debug!("[Bridge->DLL] {} {} (body_len: {} bytes)", method_str, path_arg, body_bytes.len());
                                    if headers_map.get("content-type").map(|ct| ct.contains("multipart")).unwrap_or(false) {
                                        log::info!("[Bridge->DLL] Multipart request: body_len={}, first 20 bytes: {:?}",
                                            body_bytes.len(),
                                            &body_bytes[..std::cmp::min(20, body_bytes.len())]
                                        );
                                    }

                                    let request_json = match serde_json::to_string(&request_context) {
                                        Ok(json) => json,
                                        Err(e) => {
                                            let error_json = serde_json::json!({
                                                "error": format!("Failed to serialize request context: {}", e)
                                            }).to_string();
                                            return hyper::Response::builder()
                                                .status(500)
                                                .header("Content-Type", "application/json")
                                                .header("Access-Control-Allow-Origin", "*")
                                                .body(BoxBody::new(Full::new(Bytes::from(error_json))))
                                                .unwrap();
                                        }
                                    };

                                    // Look up the plugin library
                                    let lib = {
                                        let libs = crate::bridge::core::plugin_exports::PLUGIN_LIBRARIES.lock().unwrap();
                                        libs.get(&plugin_id).cloned()
                                    };

                                    if let Some(lib) = lib {
                                        // The DLL handler creates its own runtime internally,
                                        // so we just pass a null pointer for the runtime_ptr parameter
                                        let runtime_ptr: *const () = std::ptr::null();

                                        // New handler signature: extern "C" fn(*const u8, usize, *const ()) -> *const u8
                                        // Args: request_json_ptr, request_json_len, runtime_ptr -> response_json_ptr
                                        let result: Result<libloading::Symbol<extern "C" fn(*const u8, usize, *const ()) -> *const u8>, _> = unsafe {
                                            lib.get(handler_name.as_bytes())
                                        };

                                        let response_json_str = match result {
                                            Ok(handler_fn) => {
                                                // Call the handler with full HTTP context
                                                let ptr = handler_fn(request_json.as_ptr(), request_json.len(), runtime_ptr);
                                                if ptr.is_null() {
                                                    let error_json = serde_json::json!({
                                                        "error": "Handler returned null"
                                                    }).to_string();

                                                    return hyper::Response::builder()
                                                        .status(500)
                                                        .header("Content-Type", "application/json")
                                                        .header("Access-Control-Allow-Origin", "*")
                                                        .body(BoxBody::new(Full::new(Bytes::from(error_json))))
                                                        .unwrap();
                                                }

                                                // Read the response JSON string from the pointer
                                                let response_str = unsafe {
                                                    let c_str = std::ffi::CStr::from_ptr(ptr as *const i8);
                                                    c_str.to_string_lossy().into_owned()
                                                };

                                                // Free the string (if the plugin exports free_string)
                                                let free_result: Result<libloading::Symbol<extern "C" fn(*mut u8)>, _> = unsafe {
                                                    lib.get(b"free_string")
                                                };
                                                if let Ok(free_fn) = free_result {
                                                    free_fn(ptr as *mut u8);
                                                }

                                                response_str
                                            }
                                            Err(e) => {
                                                let error_json = serde_json::json!({
                                                    "error": format!("Handler function '{}' not found: {}", handler_name, e)
                                                }).to_string();

                                                return hyper::Response::builder()
                                                    .status(500)
                                                    .header("Content-Type", "application/json")
                                                    .header("Access-Control-Allow-Origin", "*")
                                                    .body(BoxBody::new(Full::new(Bytes::from(error_json))))
                                                    .unwrap();
                                            }
                                        };

                                        // Parse the response JSON to extract status, headers, and body
                                        let response_data: serde_json::Value = match serde_json::from_str(&response_json_str) {
                                            Ok(v) => v,
                                            Err(_) => {
                                                // If parsing fails, treat the whole string as JSON body (legacy behavior)
                                                return hyper::Response::builder()
                                                    .status(200)
                                                    .header("Content-Type", "application/json")
                                                    .header("Access-Control-Allow-Origin", "*")
                                                    .body(BoxBody::new(Full::new(Bytes::from(response_json_str))))
                                                    .unwrap();
                                            }
                                        };

                                        // Check if response uses new format with status/headers/body
                                        if response_data.get("__ffi_response__").is_some() {
                                            let status = response_data.get("status")
                                                .and_then(|v| v.as_u64())
                                                .unwrap_or(200) as u16;

                                            let mut builder = hyper::Response::builder().status(status);

                                            // Check if custom headers already include CORS
                                            let mut has_cors = false;

                                            // Add custom headers
                                            if let Some(headers) = response_data.get("headers").and_then(|v| v.as_object()) {
                                                for (key, value) in headers {
                                                    if let Some(v) = value.as_str() {
                                                        if key.to_lowercase() == "access-control-allow-origin" {
                                                            has_cors = true;
                                                        }
                                                        builder = builder.header(key.as_str(), v);
                                                    }
                                                }
                                            }

                                            // Only add CORS header if not already present
                                            if !has_cors {
                                                builder = builder.header("Access-Control-Allow-Origin", "*");
                                            }

                                            // Handle body - check if it's base64 encoded binary
                                            let body_bytes = if response_data.get("body_base64").is_some() {
                                                // Binary body encoded as base64
                                                let b64 = response_data.get("body_base64")
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or("");
                                                base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64)
                                                    .unwrap_or_default()
                                            } else if let Some(body_str) = response_data.get("body").and_then(|v| v.as_str()) {
                                                // String body
                                                body_str.as_bytes().to_vec()
                                            } else if let Some(body_obj) = response_data.get("body") {
                                                // JSON object body
                                                serde_json::to_string(body_obj)
                                                    .unwrap_or_default()
                                                    .into_bytes()
                                            } else {
                                                Vec::new()
                                            };

                                            builder
                                                .body(BoxBody::new(Full::new(Bytes::from(body_bytes))))
                                                .unwrap()
                                        } else {
                                            // Legacy format - treat entire response as JSON body
                                            hyper::Response::builder()
                                                .status(200)
                                                .header("Content-Type", "application/json")
                                                .header("Access-Control-Allow-Origin", "*")
                                                .body(BoxBody::new(Full::new(Bytes::from(response_json_str))))
                                                .unwrap()
                                        }
                                    } else {
                                        let error_json = serde_json::json!({
                                            "error": format!("Plugin library not found: {}", plugin_id)
                                        }).to_string();

                                        hyper::Response::builder()
                                            .status(500)
                                            .header("Content-Type", "application/json")
                                            .header("Access-Control-Allow-Origin", "*")
                                            .body(BoxBody::new(Full::new(Bytes::from(error_json))))
                                            .unwrap()
                                    }
                                })
                            });

                            info!("       {} {} -> {}", method_str, path, handler_name);
                        }
                    }

                    // Register the router (synchronously to avoid race condition)
                    let plugin_id = plugin_info.id.clone();
                    router_registry.register(plugin_id, plugin_router).await;
                }
            }
        }
        Err(e) => {
            info!("⚠️  No dynamic plugins loaded: {}", e);
        }
    }

    info!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Start WebSocket server for real-time events
    let event_bus_ws = event_bus.clone();
    let ws_port_clone = ws_port.clone();
    tokio::spawn(async move {
        let ws_bridge = WebSocketBridge::new(event_bus_ws);
        if let Err(e) = ws_bridge.start(ws_port_clone).await {
            error!("WebSocket server error: {}", e);
        }
    });

    // Start static file server on port 3000
    let file_addr: SocketAddr = format!("127.0.0.1:{}", file_port).parse()?;
    let file_listener = TcpListener::bind(file_addr).await?;
    info!("📁 Static file server listening on http://{}", file_addr);

    tokio::spawn(async move {
        loop {
            match file_listener.accept().await {
                Ok((stream, _)) => {
                    let io = TokioIo::new(stream);
                    tokio::task::spawn(async move {
                        let service = service_fn(|req| async move {
                            Ok::<_, std::convert::Infallible>(handle_static_request(req).await)
                        });

                        let conn = http1::Builder::new()
                            .serve_connection(io, service)
                            .with_upgrades();

                        if let Err(err) = conn.await {
                            error!("Error serving static file connection: {:?}", err);
                        }
                    });
                }
                Err(e) => {
                    error!("Failed to accept static file connection: {}", e);
                }
            }
        }
    });

    // Start Bridge API server on port 3001
    let bridge_addr: SocketAddr = format!("127.0.0.1:{}", bridge_port).parse()?;
    let bridge_listener = TcpListener::bind(bridge_addr).await?;

    info!("🌐 Bridge API server listening on http://{}", bridge_addr);
    info!("📡 WebSocket server listening on ws://127.0.0.1:{}", ws_port);
    info!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    info!("✨ WebArcade Bridge is ready!");
    info!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    loop {
        let (stream, _) = bridge_listener.accept().await?;
        let io = TokioIo::new(stream);
        let router_registry = router_registry.clone_registry();

        tokio::task::spawn(async move {
            let service = service_fn(move |req| {
                let router = router_registry.clone_registry();
                async move {
                    Ok::<_, std::convert::Infallible>(handle_api_request(req, router).await)
                }
            });

            let conn = http1::Builder::new()
                .serve_connection(io, service)
                .with_upgrades();

            if let Err(err) = conn.await {
                error!("Error serving API connection: {:?}", err);
            }
        });
    }
}

/// Check if we're running in development mode (from target/ directory)
fn is_dev_mode() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.to_str().map(|s| s.to_string()))
        .map(|s| s.contains("target\\debug") || s.contains("target/debug") || s.contains("target\\release") || s.contains("target/release"))
        .unwrap_or(false)
}

/// Get the dist directory path for dev mode
fn get_dist_dir() -> Option<PathBuf> {
    let exe_path = std::env::current_exe().ok()?;
    // Path: webarcade/app/target/release/webarcade.exe -> webarcade/app/dist
    let release_dir = exe_path.parent()?;  // release/
    let target_dir = release_dir.parent()?; // target/
    let app_dir = target_dir.parent()?;     // app/
    let dist_dir = app_dir.join("dist");
    if dist_dir.exists() {
        Some(dist_dir)
    } else {
        None
    }
}

/// Serve a static file - from disk in dev mode, from embedded in production
fn serve_static_file(path: &str) -> Option<Response<BoxBody<Bytes, Infallible>>> {
    // Normalize path - default to index.html for root
    let file_path = if path == "/" || path.is_empty() {
        "index.html"
    } else {
        path.trim_start_matches('/')
    };

    // In dev mode, read from disk for hot reload support
    if is_dev_mode() {
        if let Some(dist_dir) = get_dist_dir() {
            let full_path = dist_dir.join(file_path);

            // Try the exact path, or fall back to index.html for SPA routing
            let file_to_read = if full_path.exists() {
                full_path
            } else if !file_path.contains('.') {
                dist_dir.join("index.html")
            } else {
                return None;
            };

            if let Ok(contents) = std::fs::read(&file_to_read) {
                let extension = file_to_read.extension().and_then(|e| e.to_str());
                let content_type = match extension {
                    Some("html") => "text/html; charset=utf-8",
                    Some("js") => "application/javascript; charset=utf-8",
                    Some("css") => "text/css; charset=utf-8",
                    Some("json") => "application/json",
                    Some("png") => "image/png",
                    Some("jpg") | Some("jpeg") => "image/jpeg",
                    Some("gif") => "image/gif",
                    Some("svg") => "image/svg+xml",
                    Some("ico") => "image/x-icon",
                    Some("woff") => "font/woff",
                    Some("woff2") => "font/woff2",
                    Some("ttf") => "font/ttf",
                    Some("wasm") => "application/wasm",
                    _ => "application/octet-stream",
                };

                // In dev mode, never cache anything
                return Some(Response::builder()
                    .status(StatusCode::OK)
                    .header("Content-Type", content_type)
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Cache-Control", "no-cache, no-store, must-revalidate")
                    .header("Pragma", "no-cache")
                    .header("Expires", "0")
                    .body(BoxBody::new(Full::new(Bytes::from(contents)).map_err(|_: std::convert::Infallible| unreachable!())))
                    .unwrap());
            }
        }
    }

    // Production mode: use embedded files
    let file = DIST_DIR.get_file(file_path)
        .or_else(|| {
            // If path doesn't have extension, try index.html (SPA routing)
            if !file_path.contains('.') {
                DIST_DIR.get_file("index.html")
            } else {
                None
            }
        });

    if let Some(file) = file {
        let contents = file.contents();
        let extension = file.path().extension().and_then(|e| e.to_str());
        let content_type = match extension {
            Some("html") => "text/html; charset=utf-8",
            Some("js") => "application/javascript; charset=utf-8",
            Some("css") => "text/css; charset=utf-8",
            Some("json") => "application/json",
            Some("png") => "image/png",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            Some("gif") => "image/gif",
            Some("svg") => "image/svg+xml",
            Some("ico") => "image/x-icon",
            Some("woff") => "font/woff",
            Some("woff2") => "font/woff2",
            Some("ttf") => "font/ttf",
            Some("wasm") => "application/wasm",
            _ => "application/octet-stream",
        };

        // Cache hashed assets for 1 year, don't cache HTML
        let cache_control = if extension == Some("html") {
            "no-cache, no-store, must-revalidate"
        } else {
            "public, max-age=31536000"
        };

        return Some(Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", content_type)
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", cache_control)
            .body(BoxBody::new(Full::new(Bytes::from(contents.to_vec())).map_err(|_: std::convert::Infallible| unreachable!())))
            .unwrap());
    }

    None
}

/// Handle rescan plugins request - reloads plugins from config
fn handle_rescan_plugins() -> Response<BoxBody<Bytes, Infallible>> {
    let plugins_dir = get_plugins_dir();
    let mut dynamic_loader = DynamicPluginLoader::new(plugins_dir);

    log::info!("🔄 Reloading plugins from config: {:?}", dynamic_loader.config_path());

    match dynamic_loader.load_all_plugins() {
        Ok(dynamic_plugins) => {
            let count = dynamic_plugins.len();

            // Update global state
            {
                let mut loaded = LOADED_PLUGINS.lock().unwrap();
                *loaded = dynamic_plugins;
            }

            log::info!("🔄 Reloaded {} plugins from config", count);

            let json = serde_json::json!({
                "success": true,
                "count": count
            }).to_string();

            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/json")
                .header("Access-Control-Allow-Origin", "*")
                .body(full_body(&json))
                .unwrap()
        }
        Err(e) => {
            log::error!("Failed to reload plugins from config: {}", e);
            error_response(StatusCode::INTERNAL_SERVER_ERROR, &format!("Failed to reload: {}", e))
        }
    }
}

/// Handle /api/config - serve the webarcade config
fn handle_get_config() -> Response<BoxBody<Bytes, Infallible>> {
    let plugins_dir = get_plugins_dir();
    let config_path = plugins_dir
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("webarcade.config.json"))
        .unwrap_or_else(|| plugins_dir.join("../webarcade.config.json"));

    match std::fs::read_to_string(&config_path) {
        Ok(content) => {
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", "application/json")
                .header("Access-Control-Allow-Origin", "*")
                .body(full_body(&content))
                .unwrap()
        }
        Err(e) => {
            log::error!("Failed to read config: {}", e);
            error_response(StatusCode::NOT_FOUND, "Config file not found")
        }
    }
}

/// Handle /api/assets/set-root - set the assets root directory
async fn handle_set_assets_root(req: Request<Incoming>) -> Response<BoxBody<Bytes, Infallible>> {
    // Read request body
    let body_bytes = match req.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            return error_response(StatusCode::BAD_REQUEST, &format!("Failed to read body: {}", e));
        }
    };

    // Parse JSON body
    let body: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(v) => v,
        Err(e) => {
            return error_response(StatusCode::BAD_REQUEST, &format!("Invalid JSON: {}", e));
        }
    };

    // Get the path from the request
    let root_path = match body.get("path").and_then(|v| v.as_str()) {
        Some(p) => PathBuf::from(p),
        None => {
            return error_response(StatusCode::BAD_REQUEST, "Missing 'path' field");
        }
    };

    // Verify the path exists
    if !root_path.exists() {
        return error_response(StatusCode::BAD_REQUEST, &format!("Path does not exist: {:?}", root_path));
    }

    // Set the assets root
    set_assets_root(root_path.clone());

    let json = serde_json::json!({
        "success": true,
        "path": root_path.to_string_lossy()
    }).to_string();

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .header("Access-Control-Allow-Origin", "*")
        .body(full_body(&json))
        .unwrap()
}

/// Handle /api/assets/get-root - get the current assets root directory
fn handle_get_assets_root() -> Response<BoxBody<Bytes, Infallible>> {
    let path = get_assets_root();
    let json = match path {
        Some(p) => serde_json::json!({
            "success": true,
            "path": p.to_string_lossy()
        }),
        None => serde_json::json!({
            "success": false,
            "path": null
        })
    }.to_string();

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .header("Access-Control-Allow-Origin", "*")
        .body(full_body(&json))
        .unwrap()
}

/// Serve project assets via HTTP (for browser mode)
fn serve_project_asset(asset_path: &str) -> Response<BoxBody<Bytes, Infallible>> {
    match protocols::serve_asset_file(asset_path) {
        Some((content, mime_type)) => {
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", mime_type)
                .header("Access-Control-Allow-Origin", "*")
                .body(BoxBody::new(Full::new(Bytes::from(content)).map_err(|_: std::convert::Infallible| unreachable!())))
                .unwrap()
        }
        None => {
            error_response(StatusCode::NOT_FOUND, &format!("Asset not found: {}", asset_path))
        }
    }
}

/// Handle static file requests on port 3000
/// This server only serves static files (embedded dist/) and SPA fallback
async fn handle_static_request(req: Request<Incoming>) -> Response<BoxBody<Bytes, Infallible>> {
    let method = req.method().clone();
    let path = req.uri().path().to_string();

    // Handle CORS preflight OPTIONS requests
    if method == hyper::Method::OPTIONS {
        return Response::builder()
            .status(StatusCode::OK)
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
            .header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
            .header("Access-Control-Max-Age", "86400")
            .body(full_body(""))
            .unwrap();
    }

    // Serve static files (or SPA fallback for paths without extension)
    if let Some(response) = serve_static_file(&path) {
        return response;
    }

    error_response(StatusCode::NOT_FOUND, &format!("Not found: {}", path))
}

/// Handle API requests on port 3001
/// This server handles plugin routes and API endpoints only
async fn handle_api_request(req: Request<Incoming>, router_registry: RouterRegistry) -> Response<BoxBody<Bytes, Infallible>> {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let query = req.uri().query().unwrap_or("").to_string();

    // Handle CORS preflight OPTIONS requests
    if method == hyper::Method::OPTIONS {
        return Response::builder()
            .status(StatusCode::OK)
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
            .header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
            .header("Access-Control-Max-Age", "86400")
            .body(full_body(""))
            .unwrap();
    }

    // Health check endpoint
    if path == "/health" || path == "/api/health" {
        return health_response();
    }

    // Config endpoint
    if path == "/api/config" {
        return handle_get_config();
    }

    // Runtime plugin API endpoints
    if path == "/api/plugins/list" {
        return modules::system_api::handle_list_plugins();
    }

    // Rescan plugins endpoint for hot reload
    if path == "/api/plugins/rescan" {
        return handle_rescan_plugins();
    }

    // Set assets root endpoint
    if path == "/api/assets/set-root" && method == hyper::Method::POST {
        return handle_set_assets_root(req).await;
    }

    // Get assets root endpoint
    if path == "/api/assets/get-root" {
        return handle_get_assets_root();
    }

    // Serve project assets (for browser mode) - same as app:// protocol but via HTTP
    if path.starts_with("/assets/") {
        let asset_path = &path[8..]; // Strip "/assets/"
        return serve_project_asset(asset_path);
    }

    if path.starts_with("/api/plugins/") && path.len() > 13 {
        let parts: Vec<&str> = path[13..].split('/').collect();
        if parts.len() >= 2 {
            let plugin_id = parts[0];
            let file_path = parts[1..].join("/");
            return modules::system_api::handle_serve_plugin_file(plugin_id, &file_path);
        }
    }

    // Parse plugin name from path and try plugin routes
    // Expected format: /{plugin_name}/{route}
    if path.len() > 1 {
        let path_parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
        if !path_parts.is_empty() {
            let plugin_name = path_parts[0];
            let plugin_path = if path_parts.len() > 1 {
                format!("/{}", path_parts[1..].join("/"))
            } else {
                "/".to_string()
            };

            log::debug!("Trying plugin route: plugin={}, path={}", plugin_name, plugin_path);

            // Try to route to plugin
            if let Some(response) = router_registry.route(
                plugin_name,
                &method,
                &plugin_path,
                &query,
                req,
            ).await {
                log::debug!("Plugin route matched!");
                return response;
            } else {
                log::debug!("No plugin route matched");
            }
        }
    }

    error_response(StatusCode::NOT_FOUND, &format!("API route not found: {}", path))
}

fn health_response() -> Response<BoxBody<Bytes, Infallible>> {
    let json = serde_json::json!({"status": "ok", "message": "WebArcade Bridge is ready"}).to_string();
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .header("Access-Control-Allow-Origin", "*")
        .body(full_body(&json))
        .unwrap()
}

fn error_response(status: StatusCode, message: &str) -> Response<BoxBody<Bytes, Infallible>> {
    let json = serde_json::json!({"error": message}).to_string();
    Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .header("Access-Control-Allow-Origin", "*")
        .body(full_body(&json))
        .unwrap()
}

fn full_body(s: &str) -> BoxBody<Bytes, Infallible> {
    use http_body_util::BodyExt;

    // Simpler approach using BodyExt::boxed()
    Full::new(Bytes::from(s.to_string()))
        .map_err(|_: std::convert::Infallible| unreachable!())
        .boxed()
}
