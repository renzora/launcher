use webarcade::{Request, Response};
use crate::config;

const GITHUB_API: &str = "https://api.github.com/repos/renzora/engine/releases";

fn is_editor_for_current_os(name: &str) -> bool {
    if cfg!(target_os = "windows") {
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

pub fn handle_releases(_req: Request) -> Response {
    let client = config::http_client();
    let resp = match client.get(GITHUB_API).send() {
        Ok(r) => r,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("GitHub API error: {}", e) })),
    };

    let releases: Vec<serde_json::Value> = match resp.json() {
        Ok(r) => r,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("Failed to parse: {}", e) })),
    };

    let formatted: Vec<serde_json::Value> = releases.iter().filter_map(|r| {
        let assets = r.get("assets")?.as_array()?;
        let mapped: Vec<serde_json::Value> = assets.iter().filter_map(|a| {
            let name = a.get("name")?.as_str()?;
            Some(serde_json::json!({
                "name": name,
                "url": a.get("browser_download_url")?.as_str()?,
                "size": a.get("size")?.as_u64()?,
                "kind": classify_asset(name),
                "current_os": is_editor_for_current_os(name),
            }))
        }).collect();
        Some(serde_json::json!({
            "version": r.get("tag_name")?.as_str()?,
            "name": r.get("name"),
            "published_at": r.get("published_at"),
            "prerelease": r.get("prerelease")?.as_bool()?,
            "notes": r.get("body"),
            "assets": mapped,
        }))
    }).collect();

    Response::json(&serde_json::json!({ "releases": formatted }))
}

pub fn handle_installed(_req: Request) -> Response {
    let cfg = config::load();
    let install_dir = match &cfg.install_dir {
        Some(dir) => std::path::PathBuf::from(dir),
        None => return Response::json(&serde_json::json!({ "installed": [], "install_dir": null })),
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
                            assets.push(serde_json::json!({ "name": name, "kind": classify_asset(&name) }));
                        }
                    }
                }

                let templates_dir = version_dir.join("templates");
                if templates_dir.exists() {
                    if let Ok(files) = std::fs::read_dir(&templates_dir) {
                        for file in files.flatten() {
                            let name = file.file_name().to_string_lossy().to_string();
                            assets.push(serde_json::json!({ "name": name, "kind": "template" }));
                        }
                    }
                }

                installed.push(serde_json::json!({ "version": version, "assets": assets }));
            }
        }
    }

    Response::json(&serde_json::json!({
        "installed": installed,
        "install_dir": install_dir.to_string_lossy().to_string(),
    }))
}

pub fn handle_install(req: Request) -> Response {
    let body: serde_json::Value = match req.json() {
        Ok(v) => v,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("Invalid request: {}", e) })),
    };

    let version = match body.get("version").and_then(|v| v.as_str()) {
        Some(v) => v.to_string(),
        None => return Response::json(&serde_json::json!({ "error": "Missing version" })),
    };

    let asset_names: Vec<String> = body.get("assets")
        .and_then(|a| a.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let cfg = config::load();
    let install_dir = match &cfg.install_dir {
        Some(dir) => std::path::PathBuf::from(dir),
        None => return Response::json(&serde_json::json!({ "error": "Install directory not set" })),
    };

    let version_name = version.strip_prefix('v').unwrap_or(&version);
    let version_dir = install_dir.join(version_name);
    let templates_dir = version_dir.join("templates");
    let _ = std::fs::create_dir_all(&templates_dir);

    let client = config::http_client();
    let url = format!("{}/tags/{}", GITHUB_API, version);
    let release: serde_json::Value = match client.get(&url).send().and_then(|r| r.json()) {
        Ok(r) => r,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("GitHub API error: {}", e) })),
    };

    let release_assets = release.get("assets").and_then(|a| a.as_array()).cloned().unwrap_or_default();
    let mut results: Vec<serde_json::Value> = Vec::new();

    for asset_name in &asset_names {
        let asset = match release_assets.iter().find(|a| a.get("name").and_then(|n| n.as_str()) == Some(asset_name)) {
            Some(a) => a,
            None => { results.push(serde_json::json!({ "name": asset_name, "status": "error", "message": "Asset not found" })); continue; }
        };

        let download_url = match asset.get("browser_download_url").and_then(|u| u.as_str()) {
            Some(u) => u,
            None => { results.push(serde_json::json!({ "name": asset_name, "status": "error", "message": "No download URL" })); continue; }
        };

        let dest = if classify_asset(asset_name) == "template" {
            templates_dir.join(asset_name)
        } else {
            version_dir.join(asset_name)
        };

        match client.get(download_url).send().and_then(|r| r.bytes()) {
            Ok(bytes) => {
                if let Err(e) = std::fs::write(&dest, &bytes) {
                    results.push(serde_json::json!({ "name": asset_name, "status": "error", "message": e.to_string() }));
                } else {
                    results.push(serde_json::json!({ "name": asset_name, "status": "ok" }));
                }
            }
            Err(e) => results.push(serde_json::json!({ "name": asset_name, "status": "error", "message": e.to_string() })),
        }
    }

    Response::json(&serde_json::json!({ "results": results }))
}

pub fn handle_uninstall(req: Request) -> Response {
    let body: serde_json::Value = match req.json() {
        Ok(v) => v,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("Invalid request: {}", e) })),
    };

    let version = match body.get("version").and_then(|v| v.as_str()) {
        Some(v) => v,
        None => return Response::json(&serde_json::json!({ "error": "Missing version" })),
    };

    let cfg = config::load();
    let install_dir = match &cfg.install_dir {
        Some(dir) => std::path::PathBuf::from(dir),
        None => return Response::json(&serde_json::json!({ "error": "Install directory not set" })),
    };

    let version_name = version.strip_prefix('v').unwrap_or(version);
    let version_dir = install_dir.join(version_name);

    if !version_dir.exists() {
        return Response::json(&serde_json::json!({ "error": "Version not installed" }));
    }

    match std::fs::remove_dir_all(&version_dir) {
        Ok(_) => Response::json(&serde_json::json!({ "status": "ok" })),
        Err(e) => Response::json(&serde_json::json!({ "error": format!("Failed to remove: {}", e) })),
    }
}

pub fn handle_launch(req: Request) -> Response {
    let body: serde_json::Value = match req.json() {
        Ok(v) => v,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("Invalid request: {}", e) })),
    };

    let version = match body.get("version").and_then(|v| v.as_str()) {
        Some(v) => v,
        None => return Response::json(&serde_json::json!({ "error": "Missing version" })),
    };

    let cfg = config::load();
    let install_dir = match &cfg.install_dir {
        Some(dir) => std::path::PathBuf::from(dir),
        None => return Response::json(&serde_json::json!({ "error": "Install directory not set" })),
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
        None => return Response::json(&serde_json::json!({ "error": "Editor binary not found for this OS" })),
    };

    match std::process::Command::new(&editor_path).current_dir(&version_dir).spawn() {
        Ok(_) => Response::json(&serde_json::json!({ "status": "launched" })),
        Err(e) => Response::json(&serde_json::json!({ "error": format!("Failed to launch: {}", e) })),
    }
}

pub fn handle_get_config(_req: Request) -> Response {
    let cfg = config::load();
    Response::json(&serde_json::json!({
        "install_dir": cfg.install_dir,
        "games_dir": cfg.games_dir,
        "assets_dir": cfg.assets_dir,
        "logged_in": cfg.auth_token.is_some(),
        "username": cfg.username,
        "credit_balance": cfg.credit_balance,
    }))
}

pub fn handle_set_config(req: Request) -> Response {
    let body: serde_json::Value = match req.json() {
        Ok(v) => v,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("Invalid request: {}", e) })),
    };

    let mut cfg = config::load();
    if let Some(dir) = body.get("install_dir").and_then(|v| v.as_str()) {
        cfg.install_dir = Some(dir.to_string());
    }
    if let Some(dir) = body.get("games_dir").and_then(|v| v.as_str()) {
        cfg.games_dir = Some(dir.to_string());
    }
    if let Some(dir) = body.get("assets_dir").and_then(|v| v.as_str()) {
        cfg.assets_dir = Some(dir.to_string());
    }
    config::save(&cfg);

    Response::json(&serde_json::json!({ "status": "ok" }))
}

pub fn handle_browse(_req: Request) -> Response {
    let dialog = rfd::FileDialog::new().set_title("Select Install Directory");
    match dialog.pick_folder() {
        Some(path) => Response::json(&serde_json::json!({ "path": path.to_string_lossy().to_string() })),
        None => Response::json(&serde_json::json!({ "path": null })),
    }
}
