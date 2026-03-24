pub mod router;

use api::{Plugin, PluginMetadata};

pub struct LauncherPlugin;

impl Plugin for LauncherPlugin {
    fn metadata(&self) -> PluginMetadata {
        PluginMetadata {
            id: "launcher".to_string(),
            name: "Renzora Launcher".to_string(),
            version: "0.1.0".to_string(),
            description: "Manage Renzora Engine versions and export templates".to_string(),
            author: "Renzora".to_string(),
            dependencies: vec![],
        }
    }
}
