use api::{HttpRequest, HttpResponse, json, json_response};
use serde::{Serialize, Deserialize};
use std::path::PathBuf;

const GITHUB_API: &str = "https://api.github.com/repos/renzora/engine/releases";
const LAUNCHER_VERSION: &str = "0.1.0";

// ============================================================================
// Config
// ============================================================================

#[derive(Serialize, Deserialize, Default)]
struct LauncherConfig {
    install_dir: Option<String>,
    auth_token: Option<String>,
    username: Option<String>,
    credit_balance: Option<i64>,
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("renzora-launcher")
        .join("config.json")
}

fn load_config() -> LauncherConfig {
    let path = config_path();
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        LauncherConfig::default()
    }
}

fn save_config(config: &LauncherConfig) {
    let path = config_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(data) = serde_json::to_string_pretty(config) {
        let _ = std::fs::write(&path, data);
    }
}

fn http_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .user_agent(format!("renzora-launcher/{}", LAUNCHER_VERSION))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new())
}

// ============================================================================
// Asset classification
// ============================================================================

fn is_editor_for_current_os(name: &str) -> bool {
    if cfg!(target_os = "windows") {
        // Match "renzora.exe" or "renzora-windows*"
        name == "renzora.exe" || name.starts_with("renzora-windows")
    } else if cfg!(target_os = "macos") {
        name == "renzora" || name.starts_with("renzora-macos") || name.starts_with("renzora-darwin")
    } else {
        name.starts_with("renzora-linux")
    }
}

fn classify_asset(name: &str) -> &'static str {
    if name.starts_with("renzora-runtime") || name.contains("template") {
        "template"
    } else if name.contains("server") {
        "server"
    } else {
        "editor"
    }
}

// ============================================================================
// Route handlers
// ============================================================================

pub async fn handle_releases(_req: HttpRequest) -> HttpResponse {
    let client = http_client();
    let response = match client.get(GITHUB_API).send() {
        Ok(resp) => resp,
        Err(e) => {
            return json_response(&json!({ "error": format!("GitHub API error: {}", e) }));
        }
    };

    let releases: Vec<serde_json::Value> = match response.json() {
        Ok(r) => r,
        Err(e) => {
            return json_response(&json!({ "error": format!("Failed to parse releases: {}", e) }));
        }
    };

    let formatted: Vec<serde_json::Value> = releases
        .iter()
        .filter_map(|r| {
            let assets = r.get("assets")?.as_array()?;
            let mapped_assets: Vec<serde_json::Value> = assets
                .iter()
                .filter_map(|a| {
                    let name = a.get("name")?.as_str()?;
                    let kind = classify_asset(name);
                    let is_current_os = is_editor_for_current_os(name);
                    Some(json!({
                        "name": name,
                        "url": a.get("browser_download_url")?.as_str()?,
                        "size": a.get("size")?.as_u64()?,
                        "kind": kind,
                        "current_os": is_current_os,
                    }))
                })
                .collect();

            Some(json!({
                "version": r.get("tag_name")?.as_str()?,
                "name": r.get("name"),
                "published_at": r.get("published_at"),
                "prerelease": r.get("prerelease")?.as_bool()?,
                "notes": r.get("body"),
                "assets": mapped_assets,
            }))
        })
        .collect();

    json_response(&json!({ "releases": formatted }))
}

pub async fn handle_installed(_req: HttpRequest) -> HttpResponse {
    let config = load_config();
    let install_dir = match &config.install_dir {
        Some(dir) => PathBuf::from(dir),
        None => {
            return json_response(&json!({ "installed": serde_json::Value::Array(vec![]), "install_dir": serde_json::Value::Null }));
        }
    };

    let mut installed: Vec<serde_json::Value> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&install_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let version = entry.file_name().to_string_lossy().to_string();
                let version_dir = entry.path();

                let mut assets: Vec<serde_json::Value> = Vec::new();

                if let Ok(files) = std::fs::read_dir(&version_dir) {
                    for file in files.flatten() {
                        let name = file.file_name().to_string_lossy().to_string();
                        if name != "templates" {
                            assets.push(json!({ "name": name, "kind": classify_asset(&name) }));
                        }
                    }
                }

                let templates_dir = version_dir.join("templates");
                if templates_dir.exists() {
                    if let Ok(files) = std::fs::read_dir(&templates_dir) {
                        for file in files.flatten() {
                            let name = file.file_name().to_string_lossy().to_string();
                            assets.push(json!({ "name": name, "kind": "template" }));
                        }
                    }
                }

                installed.push(json!({ "version": version, "assets": assets }));
            }
        }
    }

    json_response(&json!({
        "installed": installed,
        "install_dir": install_dir.to_string_lossy().to_string(),
    }))
}

pub async fn handle_install(req: HttpRequest) -> HttpResponse {
    let body: serde_json::Value = match req.body_json() {
        Ok(v) => v,
        Err(e) => return json_response(&json!({ "error": format!("Invalid request: {}", e) })),
    };

    let version = match body.get("version").and_then(|v| v.as_str()) {
        Some(v) => v.to_string(),
        None => return json_response(&json!({ "error": "Missing version" })),
    };

    let asset_names: Vec<String> = body
        .get("assets")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let config = load_config();
    let install_dir = match &config.install_dir {
        Some(dir) => PathBuf::from(dir),
        None => return json_response(&json!({ "error": "Install directory not set" })),
    };

    let version_name = version.strip_prefix('v').unwrap_or(&version);
    let version_dir = install_dir.join(version_name);
    let templates_dir = version_dir.join("templates");
    let _ = std::fs::create_dir_all(&templates_dir);

    let client = http_client();
    let url = format!("{}/tags/{}", GITHUB_API, version);
    let release: serde_json::Value = match client.get(&url).send().and_then(|r| r.json()) {
        Ok(r) => r,
        Err(e) => return json_response(&json!({ "error": format!("GitHub API error: {}", e) })),
    };

    let release_assets = release
        .get("assets")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();

    let mut results: Vec<serde_json::Value> = Vec::new();

    for asset_name in &asset_names {
        let asset = match release_assets.iter().find(|a| {
            a.get("name").and_then(|n| n.as_str()) == Some(asset_name)
        }) {
            Some(a) => a,
            None => {
                results.push(json!({ "name": asset_name, "status": "error", "message": "Asset not found" }));
                continue;
            }
        };

        let download_url = match asset.get("browser_download_url").and_then(|u| u.as_str()) {
            Some(u) => u,
            None => {
                results.push(json!({ "name": asset_name, "status": "error", "message": "No download URL" }));
                continue;
            }
        };

        let dest = if classify_asset(asset_name) == "template" {
            templates_dir.join(asset_name)
        } else {
            version_dir.join(asset_name)
        };

        match client.get(download_url).send() {
            Ok(resp) => match resp.bytes() {
                Ok(bytes) => {
                    if let Err(e) = std::fs::write(&dest, &bytes) {
                        results.push(json!({ "name": asset_name, "status": "error", "message": e.to_string() }));
                    } else {
                        results.push(json!({ "name": asset_name, "status": "ok" }));
                    }
                }
                Err(e) => {
                    results.push(json!({ "name": asset_name, "status": "error", "message": e.to_string() }));
                }
            },
            Err(e) => {
                results.push(json!({ "name": asset_name, "status": "error", "message": e.to_string() }));
            }
        }
    }

    json_response(&json!({ "results": results }))
}

pub async fn handle_uninstall(req: HttpRequest) -> HttpResponse {
    let body: serde_json::Value = match req.body_json() {
        Ok(v) => v,
        Err(e) => return json_response(&json!({ "error": format!("Invalid request: {}", e) })),
    };

    let version = match body.get("version").and_then(|v| v.as_str()) {
        Some(v) => v,
        None => return json_response(&json!({ "error": "Missing version" })),
    };

    let config = load_config();
    let install_dir = match &config.install_dir {
        Some(dir) => PathBuf::from(dir),
        None => return json_response(&json!({ "error": "Install directory not set" })),
    };

    let version_name = version.strip_prefix('v').unwrap_or(version);
    let version_dir = install_dir.join(version_name);

    if !version_dir.exists() {
        return json_response(&json!({ "error": "Version not installed" }));
    }

    match std::fs::remove_dir_all(&version_dir) {
        Ok(_) => json_response(&json!({ "status": "ok" })),
        Err(e) => json_response(&json!({ "error": format!("Failed to remove: {}", e) })),
    }
}

pub async fn handle_launch(req: HttpRequest) -> HttpResponse {
    let body: serde_json::Value = match req.body_json() {
        Ok(v) => v,
        Err(e) => return json_response(&json!({ "error": format!("Invalid request: {}", e) })),
    };

    let version = match body.get("version").and_then(|v| v.as_str()) {
        Some(v) => v,
        None => return json_response(&json!({ "error": "Missing version" })),
    };

    let config = load_config();
    let install_dir = match &config.install_dir {
        Some(dir) => PathBuf::from(dir),
        None => return json_response(&json!({ "error": "Install directory not set" })),
    };

    let version_name = version.strip_prefix('v').unwrap_or(version);
    let version_dir = install_dir.join(version_name);

    let mut editor_path = None;

    if let Ok(entries) = std::fs::read_dir(&version_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if is_editor_for_current_os(&name) && classify_asset(&name) == "editor" {
                editor_path = Some(entry.path());
                break;
            }
        }
    }

    let editor_path = match editor_path {
        Some(p) => p,
        None => return json_response(&json!({ "error": "Editor binary not found for this OS" })),
    };

    match std::process::Command::new(&editor_path)
        .current_dir(&version_dir)
        .spawn()
    {
        Ok(_) => json_response(&json!({ "status": "launched" })),
        Err(e) => json_response(&json!({ "error": format!("Failed to launch: {}", e) })),
    }
}

pub async fn handle_get_config(_req: HttpRequest) -> HttpResponse {
    let config = load_config();
    json_response(&json!({
        "install_dir": config.install_dir,
        "logged_in": config.auth_token.is_some(),
        "username": config.username,
        "credit_balance": config.credit_balance,
    }))
}

pub async fn handle_set_config(req: HttpRequest) -> HttpResponse {
    let body: serde_json::Value = match req.body_json() {
        Ok(v) => v,
        Err(e) => return json_response(&json!({ "error": format!("Invalid request: {}", e) })),
    };

    let mut config = load_config();
    if let Some(dir) = body.get("install_dir").and_then(|v| v.as_str()) {
        config.install_dir = Some(dir.to_string());
    }
    save_config(&config);

    json_response(&json!({ "status": "ok" }))
}

pub async fn handle_login(req: HttpRequest) -> HttpResponse {
    let body: serde_json::Value = match req.body_json() {
        Ok(v) => v,
        Err(e) => return json_response(&json!({ "error": format!("Invalid request: {}", e) })),
    };

    let email = match body.get("email").and_then(|v| v.as_str()) {
        Some(e) => e.to_string(),
        None => return json_response(&json!({ "error": "Missing email" })),
    };

    let password = match body.get("password").and_then(|v| v.as_str()) {
        Some(p) => p.to_string(),
        None => return json_response(&json!({ "error": "Missing password" })),
    };

    let client = http_client();
    let login_body = json!({ "email": email, "password": password });

    let response = match client
        .post("https://renzora.com/api/auth/login")
        .json(&login_body)
        .send()
    {
        Ok(resp) => resp,
        Err(e) => return json_response(&json!({ "error": format!("Login failed: {}", e) })),
    };

    if !response.status().is_success() {
        let error_body: serde_json::Value = response.json().unwrap_or(json!({}));
        let msg = error_body.get("error").and_then(|e| e.as_str()).unwrap_or("Invalid credentials");
        return json_response(&json!({ "error": msg }));
    }

    let login_resp: serde_json::Value = match response.json() {
        Ok(v) => v,
        Err(_) => return json_response(&json!({ "error": "Invalid response from server" })),
    };

    let access_token = login_resp.get("access_token").and_then(|t| t.as_str());
    let user = login_resp.get("user");
    let username = user.and_then(|u| u.get("username")).and_then(|n| n.as_str());
    let credit_balance = user.and_then(|u| u.get("credit_balance")).and_then(|c| c.as_i64());

    if let Some(token) = access_token {
        let mut config = load_config();
        config.auth_token = Some(token.to_string());
        config.username = username.map(|s| s.to_string());
        config.credit_balance = credit_balance;
        save_config(&config);
    } else {
        return json_response(&json!({ "error": "No access token in response" }));
    }

    json_response(&json!({
        "status": "ok",
        "username": username,
        "credit_balance": credit_balance,
    }))
}

pub async fn handle_logout(_req: HttpRequest) -> HttpResponse {
    let mut config = load_config();
    config.auth_token = None;
    config.username = None;
    config.credit_balance = None;
    save_config(&config);

    json_response(&json!({ "status": "ok" }))
}

pub async fn handle_library(_req: HttpRequest) -> HttpResponse {
    let config = load_config();
    let token = match &config.auth_token {
        Some(t) => t.clone(),
        None => return json_response(&json!({ "error": "Not logged in", "assets": [] })),
    };

    let client = http_client();
    let response = match client
        .get("https://renzora.com/api/marketplace/purchased")
        .header("Authorization", format!("Bearer {}", token))
        .send()
    {
        Ok(resp) => resp,
        Err(e) => return json_response(&json!({ "error": format!("Failed to fetch library: {}", e), "assets": [] })),
    };

    if !response.status().is_success() {
        return json_response(&json!({ "error": "Failed to fetch library", "assets": [] }));
    }

    let data: serde_json::Value = match response.json() {
        Ok(v) => v,
        Err(_) => return json_response(&json!({ "error": "Invalid response", "assets": [] })),
    };

    json_response(&data)
}

pub async fn handle_game_library(_req: HttpRequest) -> HttpResponse {
    let config = load_config();
    let token = match &config.auth_token {
        Some(t) => t.clone(),
        None => return json_response(&json!({ "error": "Not logged in", "games": [] })),
    };

    let client = http_client();
    let response = match client
        .get("https://renzora.com/api/games/library")
        .header("Authorization", format!("Bearer {}", token))
        .send()
    {
        Ok(resp) => resp,
        Err(e) => return json_response(&json!({ "error": format!("Failed to fetch: {}", e), "games": [] })),
    };

    if !response.status().is_success() {
        return json_response(&json!({ "error": "Failed to fetch game library", "games": [] }));
    }

    let data: serde_json::Value = match response.json() {
        Ok(v) => v,
        Err(_) => return json_response(&json!({ "error": "Invalid response", "games": [] })),
    };

    json_response(&data)
}

pub async fn handle_download(req: HttpRequest) -> HttpResponse {
    let body: serde_json::Value = match req.body_json() {
        Ok(v) => v,
        Err(e) => return json_response(&json!({ "error": format!("Invalid request: {}", e) })),
    };

    let asset_id = match body.get("id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return json_response(&json!({ "error": "Missing asset id" })),
    };

    let asset_name = body.get("name").and_then(|v| v.as_str()).unwrap_or("download");

    let config = load_config();
    let token = match &config.auth_token {
        Some(t) => t.clone(),
        None => return json_response(&json!({ "error": "Not logged in" })),
    };

    let install_dir = match &config.install_dir {
        Some(dir) => PathBuf::from(dir),
        None => return json_response(&json!({ "error": "Install directory not set" })),
    };

    let client = http_client();

    // Get the download URL from renzora.com
    let url = format!("https://renzora.com/api/marketplace/{}/download", asset_id);
    let response = match client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
    {
        Ok(resp) => resp,
        Err(e) => return json_response(&json!({ "error": format!("Failed to get download URL: {}", e) })),
    };

    if !response.status().is_success() {
        let error_body: serde_json::Value = response.json().unwrap_or(json!({}));
        let msg = error_body.get("error").and_then(|e| e.as_str()).unwrap_or("Download failed");
        return json_response(&json!({ "error": msg }));
    }

    let resp: serde_json::Value = match response.json() {
        Ok(v) => v,
        Err(_) => return json_response(&json!({ "error": "Invalid response" })),
    };

    let download_url = match resp.get("download_url").and_then(|u| u.as_str()) {
        Some(u) => u.to_string(),
        None => return json_response(&json!({ "error": "No download URL returned" })),
    };

    // Download the file
    let downloads_dir = install_dir.join("downloads");
    let _ = std::fs::create_dir_all(&downloads_dir);

    // Determine filename from URL or asset name
    let filename = download_url
        .split('/')
        .last()
        .unwrap_or(asset_name);
    let dest = downloads_dir.join(filename);

    match client.get(&download_url).send() {
        Ok(resp) => match resp.bytes() {
            Ok(bytes) => {
                if let Err(e) = std::fs::write(&dest, &bytes) {
                    return json_response(&json!({ "error": format!("Failed to save file: {}", e) }));
                }
                json_response(&json!({
                    "status": "ok",
                    "path": dest.to_string_lossy().to_string(),
                    "filename": filename,
                }))
            }
            Err(e) => json_response(&json!({ "error": format!("Download failed: {}", e) })),
        },
        Err(e) => json_response(&json!({ "error": format!("Download failed: {}", e) })),
    }
}

pub async fn handle_register(req: HttpRequest) -> HttpResponse {
    let body: serde_json::Value = match req.body_json() {
        Ok(v) => v,
        Err(e) => return json_response(&json!({ "error": format!("Invalid request: {}", e) })),
    };

    let username = match body.get("username").and_then(|v| v.as_str()) {
        Some(u) => u.to_string(),
        None => return json_response(&json!({ "error": "Missing username" })),
    };

    let email = match body.get("email").and_then(|v| v.as_str()) {
        Some(e) => e.to_string(),
        None => return json_response(&json!({ "error": "Missing email" })),
    };

    let password = match body.get("password").and_then(|v| v.as_str()) {
        Some(p) => p.to_string(),
        None => return json_response(&json!({ "error": "Missing password" })),
    };

    let client = http_client();
    let register_body = json!({ "username": username, "email": email, "password": password });

    let response = match client
        .post("https://renzora.com/api/auth/register")
        .json(&register_body)
        .send()
    {
        Ok(resp) => resp,
        Err(e) => return json_response(&json!({ "error": format!("Registration failed: {}", e) })),
    };

    if !response.status().is_success() {
        let error_body: serde_json::Value = response.json().unwrap_or(json!({}));
        let msg = error_body.get("error").and_then(|e| e.as_str()).unwrap_or("Registration failed");
        return json_response(&json!({ "error": msg }));
    }

    let resp: serde_json::Value = match response.json() {
        Ok(v) => v,
        Err(_) => return json_response(&json!({ "error": "Invalid response from server" })),
    };

    let access_token = resp.get("access_token").and_then(|t| t.as_str());
    let user = resp.get("user");
    let resp_username = user.and_then(|u| u.get("username")).and_then(|n| n.as_str());
    let credit_balance = user.and_then(|u| u.get("credit_balance")).and_then(|c| c.as_i64());

    if let Some(token) = access_token {
        let mut config = load_config();
        config.auth_token = Some(token.to_string());
        config.username = resp_username.map(|s| s.to_string());
        config.credit_balance = credit_balance;
        save_config(&config);
    } else {
        return json_response(&json!({ "error": "No access token in response" }));
    }

    json_response(&json!({
        "status": "ok",
        "username": resp_username,
        "credit_balance": credit_balance,
    }))
}

pub async fn handle_browse(_req: HttpRequest) -> HttpResponse {
    let dialog = rfd::FileDialog::new()
        .set_title("Select Install Directory");

    match dialog.pick_folder() {
        Some(path) => json_response(&json!({ "path": path.to_string_lossy().to_string() })),
        None => json_response(&json!({ "path": serde_json::Value::Null })),
    }
}
