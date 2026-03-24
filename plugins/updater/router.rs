use api::{HttpRequest, HttpResponse, json, json_response};

const LAUNCHER_REPO: &str = "https://api.github.com/repos/RenzoraEngine/launcher/releases/latest";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

fn http_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .user_agent(format!("renzora-launcher/{}", CURRENT_VERSION))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new())
}

pub async fn handle_check_update(_req: HttpRequest) -> HttpResponse {
    let client = http_client();
    let response = match client.get(LAUNCHER_REPO).send() {
        Ok(resp) => resp,
        Err(e) => {
            return json_response(&json!({ "error": format!("Failed to check updates: {}", e) }));
        }
    };

    let release: serde_json::Value = match response.json() {
        Ok(r) => r,
        Err(e) => {
            return json_response(&json!({ "error": format!("Failed to parse response: {}", e) }));
        }
    };

    let latest_tag = release
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let latest_version = latest_tag.strip_prefix('v').unwrap_or(latest_tag);
    let update_available = latest_version != CURRENT_VERSION;

    let platform_asset = if cfg!(target_os = "windows") {
        "renzora-launcher-windows"
    } else if cfg!(target_os = "macos") {
        "renzora-launcher-macos"
    } else {
        "renzora-launcher-linux"
    };

    let download_url = release
        .get("assets")
        .and_then(|a| a.as_array())
        .and_then(|assets| {
            assets.iter().find(|a| {
                a.get("name")
                    .and_then(|n| n.as_str())
                    .map(|n| n.starts_with(platform_asset))
                    .unwrap_or(false)
            })
        })
        .and_then(|a| a.get("browser_download_url"))
        .and_then(|u| u.as_str());

    json_response(&json!({
        "current_version": CURRENT_VERSION,
        "latest_version": latest_version,
        "update_available": update_available,
        "download_url": download_url,
        "release_notes": release.get("body"),
    }))
}

pub async fn handle_update(_req: HttpRequest) -> HttpResponse {
    let client = http_client();

    let release: serde_json::Value = match client.get(LAUNCHER_REPO).send().and_then(|r| r.json()) {
        Ok(r) => r,
        Err(e) => {
            return json_response(&json!({ "error": format!("Failed to fetch update: {}", e) }));
        }
    };

    let platform_asset = if cfg!(target_os = "windows") {
        "renzora-launcher-windows"
    } else if cfg!(target_os = "macos") {
        "renzora-launcher-macos"
    } else {
        "renzora-launcher-linux"
    };

    let download_url = match release
        .get("assets")
        .and_then(|a| a.as_array())
        .and_then(|assets| {
            assets.iter().find(|a| {
                a.get("name")
                    .and_then(|n| n.as_str())
                    .map(|n| n.starts_with(platform_asset))
                    .unwrap_or(false)
            })
        })
        .and_then(|a| a.get("browser_download_url"))
        .and_then(|u| u.as_str())
    {
        Some(url) => url.to_string(),
        None => {
            return json_response(&json!({ "error": "No update available for this platform" }));
        }
    };

    let current_exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            return json_response(&json!({ "error": format!("Cannot locate binary: {}", e) }));
        }
    };

    let temp_path = current_exe.with_extension("update");
    let backup_path = current_exe.with_extension("backup");

    let bytes = match client.get(&download_url).send().and_then(|r| r.bytes()) {
        Ok(b) => b,
        Err(e) => {
            return json_response(&json!({ "error": format!("Download failed: {}", e) }));
        }
    };

    if let Err(e) = std::fs::write(&temp_path, &bytes) {
        return json_response(&json!({ "error": format!("Failed to write update: {}", e) }));
    }

    let _ = std::fs::rename(&current_exe, &backup_path);
    if let Err(e) = std::fs::rename(&temp_path, &current_exe) {
        let _ = std::fs::rename(&backup_path, &current_exe);
        return json_response(&json!({ "error": format!("Failed to apply update: {}", e) }));
    }
    let _ = std::fs::remove_file(&backup_path);

    json_response(&json!({
        "status": "updated",
        "message": "Restart the launcher to use the new version",
    }))
}
