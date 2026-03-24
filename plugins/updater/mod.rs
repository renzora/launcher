pub mod router;

use api::{Plugin, PluginMetadata};

pub struct UpdaterPlugin;

impl Plugin for UpdaterPlugin {
    fn metadata(&self) -> PluginMetadata {
        PluginMetadata {
            id: "updater".to_string(),
            name: "Updater".to_string(),
            version: "0.1.0".to_string(),
            description: "Auto-update the launcher".to_string(),
            author: "Renzora".to_string(),
            dependencies: vec![],
        }
    }
}
