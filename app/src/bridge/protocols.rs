//! Custom protocol handlers for wry
//!
//! Provides functions for handling app:// protocol.
//! These are used by wry's custom protocol system for efficient IPC.
//!
//! - app:// - serves static files from dist/ (frontend bundle)
//! - app:///project-assets/* - serves asset files from the configured assets root

use std::path::PathBuf;
use include_dir::{include_dir, Dir};

/// Embed the dist folder at compile time (same as mod.rs)
static DIST_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/dist");

/// Get MIME type from file extension
pub fn get_mime_type(path: &str) -> &'static str {
    let extension = path.rsplit('.').next().unwrap_or("");
    match extension.to_lowercase().as_str() {
        // Web files
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "wasm" => "application/wasm",

        // Images
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "webp" => "image/webp",
        "hdr" => "image/vnd.radiance",
        "exr" => "image/x-exr",

        // Fonts
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",

        // 3D models
        "glb" => "model/gltf-binary",
        "gltf" => "model/gltf+json",
        "obj" => "text/plain",
        "fbx" => "application/octet-stream",
        "stl" => "model/stl",

        // Audio
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",

        // Video
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",

        // Text
        "txt" | "md" => "text/plain; charset=utf-8",
        "xml" => "application/xml",

        _ => "application/octet-stream",
    }
}

/// Get the dist directory path
/// Tries multiple locations to find the dist folder
fn get_dist_dir() -> Option<PathBuf> {
    let exe_path = std::env::current_exe().ok()?;

    // Try 1: Development mode - exe is in app/target/release/ or app/target/debug/
    // Path: webarcade/app/target/release/webarcade.exe -> webarcade/app/dist
    if let Some(release_dir) = exe_path.parent() {
        if let Some(target_dir) = release_dir.parent() {
            if let Some(app_dir) = target_dir.parent() {
                let dist_dir = app_dir.join("dist");
                if dist_dir.exists() {
                    return Some(dist_dir);
                }
            }
        }
    }

    // Try 2: Production mode - dist folder next to executable
    if let Some(exe_dir) = exe_path.parent() {
        let dist_dir = exe_dir.join("dist");
        if dist_dir.exists() {
            return Some(dist_dir);
        }
    }

    None
}

/// Serve a static file from the app:// protocol
/// Returns (content, mime_type) if found
pub fn serve_app_file(path: &str) -> Option<(Vec<u8>, &'static str)> {
    // Normalize path
    let file_path = if path == "/" || path.is_empty() {
        "index.html"
    } else {
        path.trim_start_matches('/')
    };

    let mime_type = get_mime_type(file_path);

    // Try 1: Read from disk (works for both dev and production with external dist)
    if let Some(dist_dir) = get_dist_dir() {
        let full_path = dist_dir.join(file_path);

        if full_path.exists() && full_path.is_file() {
            if let Ok(contents) = std::fs::read(&full_path) {
                return Some((contents, mime_type));
            }
        }

        // SPA fallback - serve index.html for paths without extension
        if !file_path.contains('.') {
            let index_path = dist_dir.join("index.html");
            if index_path.exists() {
                if let Ok(contents) = std::fs::read(&index_path) {
                    return Some((contents, "text/html; charset=utf-8"));
                }
            }
        }
    }

    // Try 2: Use embedded files (production builds with embedded dist)
    let file = DIST_DIR.get_file(file_path)
        .or_else(|| {
            // SPA fallback
            if !file_path.contains('.') {
                DIST_DIR.get_file("index.html")
            } else {
                None
            }
        });

    file.map(|f| {
        let contents = f.contents().to_vec();
        let mime = if !file_path.contains('.') && f.path().to_str() == Some("index.html") {
            "text/html; charset=utf-8"
        } else {
            mime_type
        };
        (contents, mime)
    })
}

/// Serve a file from the project-assets path
/// Uses the global ASSETS_ROOT set by plugins
pub fn serve_asset_file(path: &str) -> Option<(Vec<u8>, &'static str)> {
    let assets_root = super::get_assets_root()?;

    let file_path = path.trim_start_matches('/');
    let full_path = assets_root.join(file_path);

    // Security check - ensure path is within assets root
    let canonical_root = assets_root.canonicalize().ok()?;
    let canonical_path = full_path.canonicalize().ok()?;

    if !canonical_path.starts_with(&canonical_root) {
        log::warn!("Asset path escapes root: {:?}", path);
        return None;
    }

    if !canonical_path.is_file() {
        return None;
    }

    let contents = std::fs::read(&canonical_path).ok()?;
    let mime_type = get_mime_type(path);

    Some((contents, mime_type))
}
