use webarcade::{Request, Response};
use crate::config;

/// POST /api/upload/file-picker — open native file dialog, return selected path
pub fn handle_file_picker(req: Request) -> Response {
    let body: serde_json::Value = req.json().unwrap_or_default();
    let picker_type = body.get("type").and_then(|v| v.as_str()).unwrap_or("file");
    let accept = body.get("accept").and_then(|v| v.as_str()).unwrap_or("");

    match picker_type {
        "file" => {
            let mut dialog = rfd::FileDialog::new().set_title("Select File");
            if !accept.is_empty() {
                let exts: Vec<&str> = accept.split(',').map(|s| s.trim().trim_start_matches('.')).collect();
                dialog = dialog.add_filter("Accepted Files", &exts);
            }
            match dialog.pick_file() {
                Some(path) => {
                    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();
                    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                    Response::json(&serde_json::json!({
                        "path": path.to_string_lossy().to_string(),
                        "name": name,
                        "size": size,
                    }))
                }
                None => Response::json(&serde_json::json!({ "path": null })),
            }
        }
        "files" => {
            let mut dialog = rfd::FileDialog::new().set_title("Select Files");
            if !accept.is_empty() {
                let exts: Vec<&str> = accept.split(',').map(|s| s.trim().trim_start_matches('.')).collect();
                dialog = dialog.add_filter("Accepted Files", &exts);
            }
            match dialog.pick_files() {
                Some(paths) => {
                    let files: Vec<serde_json::Value> = paths.iter().map(|p| {
                        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();
                        let size = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
                        serde_json::json!({ "path": p.to_string_lossy().to_string(), "name": name, "size": size })
                    }).collect();
                    Response::json(&serde_json::json!({ "files": files }))
                }
                None => Response::json(&serde_json::json!({ "files": [] })),
            }
        }
        _ => Response::json(&serde_json::json!({ "error": "Unknown picker type" })),
    }
}

/// POST /api/upload/publish — reads files from disk, builds multipart, uploads to renzora.com API
pub fn handle_publish(req: Request) -> Response {
    let body: serde_json::Value = match req.json() {
        Ok(v) => v,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("Invalid request: {}", e) })),
    };

    let cfg = config::load();
    let token = match &cfg.auth_token {
        Some(t) => t.clone(),
        None => return Response::json(&serde_json::json!({ "error": "Not logged in" })),
    };

    let content_type = body.get("content_type").and_then(|v| v.as_str()).unwrap_or("asset");
    let metadata = match body.get("metadata") {
        Some(m) => m.clone(),
        None => return Response::json(&serde_json::json!({ "error": "Missing metadata" })),
    };

    // Support single file_path or multiple file_paths
    let file_paths: Vec<String> = if let Some(paths) = body.get("file_paths").and_then(|v| v.as_array()) {
        paths.iter().filter_map(|v| v.as_str().map(String::from)).collect()
    } else if let Some(p) = body.get("file_path").and_then(|v| v.as_str()) {
        vec![p.to_string()]
    } else {
        return Response::json(&serde_json::json!({ "error": "Missing file_path or file_paths" }));
    };

    let thumbnail_path = body.get("thumbnail_path").and_then(|v| v.as_str()).map(|s| s.to_string());
    let screenshot_paths: Vec<String> = body.get("screenshot_paths")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    // Build multipart form
    let client = reqwest::blocking::Client::builder()
        .user_agent("renzora-launcher/0.1.0")
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new());

    let metadata_json = serde_json::to_string(&metadata).unwrap_or_default();

    let mut form = reqwest::blocking::multipart::Form::new()
        .text("metadata", metadata_json);

    // Append file(s)
    for file_path in &file_paths {
        let file_data = match std::fs::read(file_path) {
            Ok(d) => d,
            Err(e) => return Response::json(&serde_json::json!({ "error": format!("Failed to read file: {}", e) })),
        };
        let file_name = std::path::Path::new(file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("asset.zip")
            .to_string();
        form = form.part("file", reqwest::blocking::multipart::Part::bytes(file_data)
            .file_name(file_name)
            .mime_str("application/octet-stream").unwrap());
    }

    // Thumbnail
    if let Some(thumb_path) = &thumbnail_path {
        if let Ok(thumb_data) = std::fs::read(thumb_path) {
            let thumb_name = std::path::Path::new(thumb_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("thumb.png")
                .to_string();
            form = form.part("thumbnail", reqwest::blocking::multipart::Part::bytes(thumb_data)
                .file_name(thumb_name)
                .mime_str("image/png").unwrap());
        }
    }

    // Screenshots
    for (i, ss_path) in screenshot_paths.iter().enumerate() {
        if let Ok(ss_data) = std::fs::read(ss_path) {
            let ss_name = std::path::Path::new(ss_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("screenshot.png")
                .to_string();
            form = form.part(format!("screenshot_{}", i), reqwest::blocking::multipart::Part::bytes(ss_data)
                .file_name(ss_name)
                .mime_str("image/png").unwrap());
        }
    }

    let url = if content_type == "game" {
        "https://renzora.com/api/games/upload"
    } else {
        "https://renzora.com/api/marketplace/upload"
    };

    match client.post(url)
        .header("Authorization", format!("Bearer {}", token))
        .multipart(form)
        .send()
    {
        Ok(resp) => {
            let status = resp.status().as_u16();
            match resp.text() {
                Ok(text) => {
                    let json: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::json!({ "error": "Invalid response" }));
                    if status >= 400 {
                        let err = json.get("error").and_then(|e| e.as_str()).unwrap_or("Upload failed");
                        Response::json(&serde_json::json!({ "error": err }))
                    } else {
                        Response::json(&json)
                    }
                }
                Err(e) => Response::json(&serde_json::json!({ "error": format!("Failed to read response: {}", e) })),
            }
        }
        Err(e) => Response::json(&serde_json::json!({ "error": format!("Upload failed: {}", e) })),
    }
}
