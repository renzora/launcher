// Embedded plugins module
// This module provides access to plugins that are compiled into the binary

// Include the auto-generated embedded plugins code from build.rs
include!(concat!(env!("OUT_DIR"), "/embedded_plugins.rs"));

use std::collections::HashMap;
use std::sync::OnceLock;

/// Cache for extracted embedded plugins (maps plugin_id -> file_path -> data)
static EMBEDDED_CACHE: OnceLock<HashMap<String, HashMap<String, &'static [u8]>>> = OnceLock::new();

/// Initialize the embedded plugins cache
pub fn init_embedded_cache() -> &'static HashMap<String, HashMap<String, &'static [u8]>> {
    EMBEDDED_CACHE.get_or_init(|| {
        let mut cache = HashMap::new();

        for plugin in get_embedded_plugins() {
            let mut files = HashMap::new();
            for (path, data) in plugin.files {
                files.insert(path.to_string(), *data);
            }
            cache.insert(plugin.id.to_string(), files);
        }

        cache
    })
}

/// Check if we have any embedded plugins
pub fn has_embedded_plugins() -> bool {
    !get_embedded_plugins().is_empty()
}

/// Get a list of embedded plugin IDs
pub fn get_embedded_plugin_ids() -> Vec<&'static str> {
    get_embedded_plugins().iter().map(|p| p.id).collect()
}

/// Get a file from an embedded plugin
pub fn get_embedded_file(plugin_id: &str, file_path: &str) -> Option<&'static [u8]> {
    let cache = init_embedded_cache();
    cache.get(plugin_id)
        .and_then(|files| files.get(file_path))
        .copied()
}

/// Get all files for an embedded plugin
pub fn get_embedded_plugin_files(plugin_id: &str) -> Option<&HashMap<String, &'static [u8]>> {
    let cache = init_embedded_cache();
    cache.get(plugin_id)
}

/// Check if a plugin is embedded
pub fn is_plugin_embedded(plugin_id: &str) -> bool {
    let cache = init_embedded_cache();
    cache.contains_key(plugin_id)
}

/// Get the package.json content for an embedded plugin
pub fn get_embedded_package_json(plugin_id: &str) -> Option<&'static [u8]> {
    get_embedded_file(plugin_id, "package.json")
}

/// Get the plugin.js content for an embedded plugin
pub fn get_embedded_plugin_js(plugin_id: &str) -> Option<&'static [u8]> {
    get_embedded_file(plugin_id, "plugin.js")
}

/// Get the DLL/so/dylib content for an embedded plugin
pub fn get_embedded_native_lib(plugin_id: &str) -> Option<(&'static str, &'static [u8])> {
    let cache = init_embedded_cache();
    if let Some(files) = cache.get(plugin_id) {
        // Look for platform-specific library
        #[cfg(target_os = "windows")]
        let extensions = [".dll"];
        #[cfg(target_os = "linux")]
        let extensions = [".so"];
        #[cfg(target_os = "macos")]
        let extensions = [".dylib"];

        for (path, data) in files {
            for ext in &extensions {
                if path.ends_with(ext) {
                    return Some((path.as_str(), *data));
                }
            }
        }
    }
    None
}
