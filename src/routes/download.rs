use webarcade::{Request, Response};
use crate::config;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::io::Write;

lazy_static::lazy_static! {
    static ref DOWNLOADS: Arc<Mutex<HashMap<String, DownloadState>>> = Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Clone, serde::Serialize)]
struct DownloadState {
    id: String,
    name: String,
    status: String,        // "downloading", "done", "error"
    downloaded: u64,
    total: u64,
    error: Option<String>,
    path: Option<String>,
}

/// POST /api/download/start — kicks off download in background, returns immediately
pub fn handle_start(req: Request) -> Response {
    let body: serde_json::Value = match req.json() {
        Ok(v) => v,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("Invalid request: {}", e) })),
    };

    let asset_id = match body.get("id") {
        Some(v) if v.is_string() => v.as_str().unwrap().to_string(),
        Some(v) if v.is_number() => v.to_string(),
        _ => return Response::json(&serde_json::json!({ "error": "Missing asset id" })),
    };
    let asset_name = body.get("name").and_then(|v| v.as_str()).unwrap_or("download").to_string();
    let download_type = body.get("type").and_then(|v| v.as_str()).unwrap_or("asset").to_string();

    let cfg = config::load();
    let token = match &cfg.auth_token {
        Some(t) => t.clone(),
        None => return Response::json(&serde_json::json!({ "error": "Not logged in" })),
    };
    let download_dir = match download_type.as_str() {
        "game" => cfg.games_dir.as_deref().or(cfg.install_dir.as_deref()),
        "asset" => cfg.assets_dir.as_deref().or(cfg.install_dir.as_deref()),
        _ => cfg.install_dir.as_deref(),
    };
    let install_dir = match download_dir {
        Some(dir) => std::path::PathBuf::from(dir),
        None => return Response::json(&serde_json::json!({ "error": "Install directory not set. Configure it in Settings." })),
    };

    let dl_id = asset_id.clone();

    // Initialize state
    {
        let mut downloads = DOWNLOADS.lock().unwrap();
        downloads.insert(dl_id.clone(), DownloadState {
            id: dl_id.clone(),
            name: asset_name.clone(),
            status: "downloading".to_string(),
            downloaded: 0,
            total: 0,
            error: None,
            path: None,
        });
    }

    // Spawn background download
    let downloads = DOWNLOADS.clone();
    std::thread::spawn(move || {
        let result = do_download(&dl_id, &asset_name, &token, &install_dir, &downloads);
        let mut downloads = downloads.lock().unwrap();
        if let Some(state) = downloads.get_mut(&dl_id) {
            match result {
                Ok(path) => {
                    state.status = "done".to_string();
                    state.path = Some(path);
                }
                Err(e) => {
                    state.status = "error".to_string();
                    state.error = Some(e);
                }
            }
        }
    });

    Response::json(&serde_json::json!({ "status": "started", "id": asset_id }))
}

fn do_download(
    asset_id: &str,
    asset_name: &str,
    token: &str,
    install_dir: &std::path::Path,
    downloads: &Arc<Mutex<HashMap<String, DownloadState>>>,
) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("renzora-launcher/0.1.0")
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    // Get download URL
    let url = format!("https://renzora.com/api/marketplace/{}/download", asset_id);
    let resp = client.get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .map_err(|e| format!("Failed to get download URL: {}", e))?;

    if !resp.status().is_success() {
        let err: serde_json::Value = resp.json().unwrap_or(serde_json::json!({}));
        return Err(err.get("error").and_then(|e| e.as_str()).unwrap_or("Download failed").to_string());
    }

    let data: serde_json::Value = resp.json().map_err(|_| "Invalid response".to_string())?;
    let download_url = data.get("download_url").and_then(|u| u.as_str())
        .ok_or("No download URL returned")?
        .to_string();

    let _ = std::fs::create_dir_all(install_dir);
    // Prefer download_filename from API (human-readable), fall back to URL-derived name
    let filename = data.get("download_filename")
        .and_then(|f| f.as_str())
        .filter(|f| !f.is_empty())
        .unwrap_or_else(|| download_url.split('/').last().unwrap_or(asset_name));
    let dest = install_dir.join(filename);

    // Stream download with progress
    let mut resp = client.get(&download_url).send().map_err(|e| format!("Download failed: {}", e))?;
    let total = resp.content_length().unwrap_or(0);

    {
        let mut downloads = downloads.lock().unwrap();
        if let Some(state) = downloads.get_mut(asset_id) {
            state.total = total;
        }
    }

    let mut file = std::fs::File::create(&dest).map_err(|e| format!("Failed to create file: {}", e))?;
    let mut downloaded: u64 = 0;
    let mut buf = [0u8; 8192];

    loop {
        let n = std::io::Read::read(&mut resp, &mut buf).map_err(|e| format!("Read error: {}", e))?;
        if n == 0 { break; }
        file.write_all(&buf[..n]).map_err(|e| format!("Write error: {}", e))?;
        downloaded += n as u64;

        let mut downloads = downloads.lock().unwrap();
        if let Some(state) = downloads.get_mut(asset_id) {
            state.downloaded = downloaded;
        }
    }

    // Record in manifest so we can check later
    save_to_manifest(install_dir, asset_id, &dest);

    Ok(dest.to_string_lossy().to_string())
}

fn manifest_path(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join(".downloaded.json")
}

fn load_manifest(dir: &std::path::Path) -> HashMap<String, String> {
    let path = manifest_path(dir);
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        HashMap::new()
    }
}

fn save_to_manifest(dir: &std::path::Path, id: &str, file_path: &std::path::Path) {
    let mut manifest = load_manifest(dir);
    manifest.insert(id.to_string(), file_path.to_string_lossy().to_string());
    if let Ok(data) = serde_json::to_string_pretty(&manifest) {
        let _ = std::fs::write(manifest_path(dir), data);
    }
}

/// GET /api/download/progress?id=xxx — returns current download state
pub fn handle_progress(req: Request) -> Response {
    let id = match req.query("id") {
        Some(id) => id.to_string(),
        None => return Response::json(&serde_json::json!({ "error": "Missing id" })),
    };

    let downloads = DOWNLOADS.lock().unwrap();
    match downloads.get(&id) {
        Some(state) => Response::json(state),
        None => Response::json(&serde_json::json!({ "error": "No download found" })),
    }
}

/// POST /api/download/check — check which asset IDs are already downloaded
pub fn handle_check(req: Request) -> Response {
    let body: serde_json::Value = match req.json() {
        Ok(v) => v,
        Err(_) => return Response::json(&serde_json::json!({ "downloaded_ids": [] })),
    };

    let ids = body.get("ids").and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| {
            v.as_str().map(String::from).or_else(|| Some(v.to_string()))
        }).collect::<Vec<_>>())
        .unwrap_or_default();

    let check_type = body.get("type").and_then(|v| v.as_str()).unwrap_or("asset");

    let cfg = config::load();
    let dir = match check_type {
        "game" => cfg.games_dir.as_deref().or(cfg.install_dir.as_deref()),
        "asset" => cfg.assets_dir.as_deref().or(cfg.install_dir.as_deref()),
        _ => cfg.install_dir.as_deref(),
    };

    let dir = match dir {
        Some(d) => std::path::PathBuf::from(d),
        None => return Response::json(&serde_json::json!({ "downloaded_ids": [] })),
    };

    let manifest = load_manifest(&dir);

    let downloaded_ids: Vec<&str> = ids.iter()
        .filter(|id| {
            manifest.get(id.as_str()).map(|path| std::path::Path::new(path).exists()).unwrap_or(false)
        })
        .map(|s| s.as_str())
        .collect();

    Response::json(&serde_json::json!({ "downloaded_ids": downloaded_ids }))
}

/// POST /api/download/clear — remove a completed download from tracking
pub fn handle_clear(req: Request) -> Response {
    let body: serde_json::Value = match req.json() {
        Ok(v) => v,
        Err(_) => return Response::json(&serde_json::json!({ "status": "ok" })),
    };

    if let Some(id) = body.get("id").and_then(|v| v.as_str()) {
        let mut downloads = DOWNLOADS.lock().unwrap();
        downloads.remove(id);
    }

    Response::json(&serde_json::json!({ "status": "ok" }))
}
