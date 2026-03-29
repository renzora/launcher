use serde::{Serialize, Deserialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Default)]
pub struct LauncherConfig {
    pub install_dir: Option<String>,
    pub games_dir: Option<String>,
    pub assets_dir: Option<String>,
    pub auth_token: Option<String>,
    pub username: Option<String>,
    pub credit_balance: Option<i64>,
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("renzora-launcher")
        .join("config.json")
}

pub fn load() -> LauncherConfig {
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

pub fn save(config: &LauncherConfig) {
    let path = config_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(data) = serde_json::to_string_pretty(config) {
        let _ = std::fs::write(&path, data);
    }
}

pub fn http_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .user_agent("renzora-launcher/0.1.0")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new())
}
