use std::path::PathBuf;

const LAUNCHER_REPO: &str = "https://api.github.com/repos/renzora/launcher/releases/latest";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Check for updates and apply them before the UI loads.
/// Returns `true` if the app should relaunch (update was applied).
pub fn check_and_update() -> bool {
    log::info!("[UPDATE] Checking for updates (current: v{})...", CURRENT_VERSION);

    let client = match reqwest::blocking::Client::builder()
        .user_agent(format!("renzora-launcher/{}", CURRENT_VERSION))
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[UPDATE] Failed to create HTTP client: {}", e);
            return false;
        }
    };

    // Fetch latest release
    let release: serde_json::Value = match client.get(LAUNCHER_REPO).send() {
        Ok(resp) if resp.status().is_success() => match resp.json() {
            Ok(v) => v,
            Err(_) => return false,
        },
        _ => {
            log::info!("[UPDATE] Could not reach GitHub, skipping update check");
            return false;
        }
    };

    // Compare versions
    let latest_tag = release
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let latest_version = latest_tag.strip_prefix('v').unwrap_or(latest_tag);

    if latest_version.is_empty() || latest_version == CURRENT_VERSION {
        log::info!("[UPDATE] Already up to date (v{})", CURRENT_VERSION);
        return false;
    }

    log::info!("[UPDATE] New version available: v{} -> v{}", CURRENT_VERSION, latest_version);

    // Find the asset for this platform
    let platform_prefix = if cfg!(target_os = "windows") {
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
                    .map(|n| n.starts_with(platform_prefix))
                    .unwrap_or(false)
            })
        })
        .and_then(|a| a.get("browser_download_url"))
        .and_then(|u| u.as_str())
    {
        Some(url) => url.to_string(),
        None => {
            log::warn!("[UPDATE] No binary found for this platform");
            return false;
        }
    };

    log::info!("[UPDATE] Downloading update...");

    // Download the new binary
    let bytes = match client.get(&download_url).send() {
        Ok(resp) if resp.status().is_success() => match resp.bytes() {
            Ok(b) => b,
            Err(e) => {
                log::warn!("[UPDATE] Download failed: {}", e);
                return false;
            }
        },
        _ => {
            log::warn!("[UPDATE] Download request failed");
            return false;
        }
    };

    log::info!("[UPDATE] Downloaded {} bytes, applying update...", bytes.len());

    // Swap the binary
    let current_exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            log::warn!("[UPDATE] Cannot locate current binary: {}", e);
            return false;
        }
    };

    let temp_path = current_exe.with_extension("update");
    let backup_path = current_exe.with_extension("backup");

    // Write new binary to temp file
    if let Err(e) = std::fs::write(&temp_path, &bytes) {
        log::warn!("[UPDATE] Failed to write update file: {}", e);
        return false;
    }

    // Swap: current → backup, update → current
    let _ = std::fs::remove_file(&backup_path);
    if let Err(e) = std::fs::rename(&current_exe, &backup_path) {
        log::warn!("[UPDATE] Failed to backup current binary: {}", e);
        let _ = std::fs::remove_file(&temp_path);
        return false;
    }

    if let Err(e) = std::fs::rename(&temp_path, &current_exe) {
        log::warn!("[UPDATE] Failed to replace binary: {}", e);
        // Restore backup
        let _ = std::fs::rename(&backup_path, &current_exe);
        return false;
    }

    // Clean up backup
    let _ = std::fs::remove_file(&backup_path);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&current_exe, std::fs::Permissions::from_mode(0o755));
    }

    log::info!("[UPDATE] Update applied! Relaunching...");
    true
}

/// Relaunch the current executable with --just-updated flag and exit.
pub fn relaunch() -> ! {
    let exe = std::env::current_exe().expect("Cannot locate executable");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;
        let _ = std::process::Command::new(&exe)
            .arg("--just-updated")
            .creation_flags(DETACHED_PROCESS)
            .spawn();
    }

    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new(&exe)
            .arg("--just-updated")
            .spawn();
    }

    std::process::exit(0);
}
