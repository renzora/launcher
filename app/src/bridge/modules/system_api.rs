use hyper::{Response, StatusCode};
use http_body_util::{Full, combinators::BoxBody};
use hyper::body::Bytes;
use std::convert::Infallible;
use std::path::PathBuf;

use crate::bridge::core::dynamic_plugin_loader::DynamicPluginLoader;

/// Check if we're running in development mode
pub fn is_dev_mode() -> bool {
    let exe_path = std::env::current_exe().ok();
    let is_dev = exe_path.as_ref()
        .and_then(|p| p.to_str())
        .map(|s| s.contains("target\\debug") || s.contains("target/debug"))
        .unwrap_or(false);
    log::info!("🔍 is_dev_mode: {} (exe: {:?})", is_dev, exe_path);
    is_dev
}

/// Get the repo root directory (only valid in dev mode)
pub fn get_repo_root() -> Option<PathBuf> {
    let exe_path = std::env::current_exe().ok()?;
    log::info!("🔍 get_repo_root: exe_path = {:?}", exe_path);
    let target_dir = exe_path.parent()?; // debug or release
    log::info!("🔍 get_repo_root: target_dir (debug/release) = {:?}", target_dir);
    let target = target_dir.parent()?; // target
    log::info!("🔍 get_repo_root: target = {:?}", target);
    let src_tauri = target.parent()?; // src-tauri
    log::info!("🔍 get_repo_root: src_tauri = {:?}", src_tauri);
    let repo_root = src_tauri.parent()?; // repo root
    log::info!("🔍 get_repo_root: repo_root = {:?}", repo_root);
    Some(repo_root.to_path_buf())
}

/// Get the plugins directory based on environment
/// - Development: {repo_root}/build/plugins (built plugins)
/// - Production: {exe_dir}/plugins (next to the executable)
pub fn get_plugins_dir() -> PathBuf {
    let exe_path = std::env::current_exe().ok();
    let exe_dir = exe_path.as_ref()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    if is_dev_mode() {
        // Development: use repo root's build/plugins/ directory for built plugins
        if let Some(repo_root) = get_repo_root() {
            let build_plugins_dir = repo_root.join("build").join("plugins");
            log::info!("🔍 Dev mode plugins dir: {:?} (exists: {})", build_plugins_dir, build_plugins_dir.exists());
            if build_plugins_dir.exists() || std::fs::create_dir_all(&build_plugins_dir).is_ok() {
                return build_plugins_dir;
            }
        }
        // Fallback: try current directory
        let fallback = std::env::current_dir()
            .unwrap_or_default()
            .join("build")
            .join("plugins");
        log::info!("🔍 Dev mode fallback plugins dir: {:?}", fallback);
        fallback
    } else {
        // Production: try multiple locations
        // 1. First check next to executable (Windows MSI installs here)
        if let Some(ref dir) = exe_dir {
            let plugins_dir = dir.join("plugins");
            if plugins_dir.exists() {
                return plugins_dir;
            }
        }

        // 2. Check in Resources folder (macOS .app bundle)
        if let Some(ref dir) = exe_dir {
            let resources_plugins = dir.join("../Resources/plugins");
            if resources_plugins.exists() {
                return resources_plugins;
            }
        }

        // 3. Fallback to exe directory even if plugins folder doesn't exist yet
        exe_dir
            .unwrap_or_default()
            .join("plugins")
    }
}

/// Handle /api/plugins/list - list runtime plugins
/// Now reads plugin info from the global loaded plugins state
pub fn handle_list_plugins() -> Response<BoxBody<Bytes, Infallible>> {
    // Get the loaded plugins from the global state
    let loaded_plugins = crate::bridge::LOADED_PLUGINS.lock().unwrap();

    let mut plugins = Vec::new();

    for plugin_info in loaded_plugins.iter() {
        let plugin_metadata = serde_json::json!({
            "id": plugin_info.id,
            "name": plugin_info.name,
            "version": plugin_info.version,
            "description": plugin_info.description,
            "author": plugin_info.author,
            "priority": plugin_info.priority,
            "routes": plugin_info.routes,
            "has_plugin_js": plugin_info.has_frontend,
            "has_dll": plugin_info.has_backend
        });

        plugins.push(plugin_metadata);
    }

    let json = serde_json::json!({
        "plugins": plugins
    }).to_string();

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .header("Access-Control-Allow-Origin", "*")
        .body(full_body(&json))
        .unwrap()
}

/// Handle /api/plugins/{plugin_id}/{file} - serve plugin files
/// For plugin.js, retrieves from file (frontend-only) or embedded DLL content
pub fn handle_serve_plugin_file(plugin_id: &str, file_path: &str) -> Response<BoxBody<Bytes, Infallible>> {
    // For plugin.js (legacy) or {plugin_id}.js, check if it's a frontend-only plugin first
    let expected_js_name = format!("{}.js", plugin_id);
    if file_path == "plugin.js" || file_path == expected_js_name {
        // Check if this is a frontend-only plugin with a file path or embedded JS
        let loaded_plugins = crate::bridge::LOADED_PLUGINS.lock().unwrap();
        if let Some(plugin_info) = loaded_plugins.iter().find(|p| p.id == plugin_id) {
            // Check for embedded JS first (locked-plugins mode)
            #[cfg(feature = "locked-plugins")]
            if let Some(ref _embedded_key) = plugin_info.embedded_js {
                if let Some(js_content) = crate::bridge::core::plugin_exports::get_embedded_js(plugin_id) {
                    return Response::builder()
                        .status(StatusCode::OK)
                        .header("Content-Type", "application/javascript")
                        .header("Access-Control-Allow-Origin", "*")
                        .body(BoxBody::new(Full::new(Bytes::from(js_content))))
                        .unwrap();
                }
            }

            // Check for file-based frontend (unlocked mode)
            if let Some(ref frontend_path) = plugin_info.frontend_path {
                // Frontend-only plugin - serve from file
                match std::fs::read_to_string(frontend_path) {
                    Ok(js_content) => {
                        return Response::builder()
                            .status(StatusCode::OK)
                            .header("Content-Type", "application/javascript")
                            .header("Access-Control-Allow-Origin", "*")
                            .body(BoxBody::new(Full::new(Bytes::from(js_content))))
                            .unwrap();
                    }
                    Err(e) => {
                        log::warn!("Failed to read frontend file for plugin {}: {}", plugin_id, e);
                        return error_response(StatusCode::NOT_FOUND, "Plugin frontend file not found");
                    }
                }
            }
        }
        drop(loaded_plugins); // Release lock before calling get_frontend_js

        // DLL-based plugin - serve from embedded content
        match DynamicPluginLoader::get_frontend_js(plugin_id) {
            Ok(js_content) => {
                return Response::builder()
                    .status(StatusCode::OK)
                    .header("Content-Type", "application/javascript")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(BoxBody::new(Full::new(Bytes::from(js_content))))
                    .unwrap();
            }
            Err(e) => {
                log::warn!("Failed to get frontend for plugin {}: {}", plugin_id, e);
                return error_response(StatusCode::NOT_FOUND, "Plugin frontend not found");
            }
        }
    }

    // For other files, return not found (plugins are now self-contained in DLLs)
    error_response(StatusCode::NOT_FOUND, "File not found - plugins are now self-contained in DLLs")
}

fn full_body(s: &str) -> BoxBody<Bytes, Infallible> {
    use http_body_util::combinators::BoxBody;
    use http_body_util::BodyExt;
    BoxBody::new(Full::new(Bytes::from(s.to_string())).map_err(|err: Infallible| match err {}))
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
