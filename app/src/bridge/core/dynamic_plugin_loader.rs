use libloading::Library;
use std::path::{Path, PathBuf};
use std::fs;
use std::sync::Arc;
use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

// Include embedded plugins when feature is enabled
#[cfg(feature = "locked-plugins")]
mod embedded {
    include!(concat!(env!("OUT_DIR"), "/embedded_plugins.rs"));
}

/// Plugin configuration from webarcade.config.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginConfig {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    pub path: String,
    #[serde(default)]
    pub has_backend: bool,
    #[serde(default = "default_has_frontend")]
    pub has_frontend: bool,
    #[serde(default = "default_priority")]
    pub priority: i32,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub routes: Vec<serde_json::Value>,
    /// Other plugin IDs this plugin depends on (will be loaded first)
    #[serde(default)]
    pub dependencies: Vec<String>,
}

fn default_has_frontend() -> bool { true }
fn default_priority() -> i32 { 100 }
fn default_enabled() -> bool { true }

/// WebArcade configuration file structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebArcadeConfig {
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub default_layout: Option<String>,
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default = "default_height")]
    pub height: u32,
    #[serde(default)]
    pub plugins: HashMap<String, PluginConfig>,
}

fn default_width() -> u32 { 1280 }
fn default_height() -> u32 { 720 }

impl WebArcadeConfig {
    /// Load config from file
    pub fn load(config_path: &Path) -> Result<Self> {
        let content = fs::read_to_string(config_path)
            .map_err(|e| anyhow!("Failed to read config file: {}", e))?;

        let config: WebArcadeConfig = serde_json::from_str(&content)
            .map_err(|e| anyhow!("Failed to parse config file: {}", e))?;

        Ok(config)
    }

    /// Save config to file
    pub fn save(&self, config_path: &Path) -> Result<()> {
        let content = serde_json::to_string_pretty(self)?;
        fs::write(config_path, content)?;
        Ok(())
    }
}

pub struct DynamicPluginLoader {
    plugins_dir: PathBuf,
    config_path: PathBuf,
}

impl DynamicPluginLoader {
    pub fn new(plugins_dir: PathBuf) -> Self {
        // Config is in the repo root (parent of app/)
        let config_path = plugins_dir
            .parent() // app/
            .and_then(|p| p.parent()) // repo root
            .map(|p| p.join("webarcade.config.json"))
            .unwrap_or_else(|| plugins_dir.join("../webarcade.config.json"));

        Self { plugins_dir, config_path }
    }

    /// Set a custom config path
    pub fn with_config_path(mut self, config_path: PathBuf) -> Self {
        self.config_path = config_path;
        self
    }

    /// Load all plugins from config
    ///
    /// When `locked-plugins` feature is enabled: loads from embedded binary data
    /// Otherwise: loads from config file
    pub fn load_all_plugins(&mut self) -> Result<Vec<PluginInfo>> {
        #[cfg(feature = "locked-plugins")]
        {
            self.load_embedded_plugins()
        }

        #[cfg(not(feature = "locked-plugins"))]
        {
            self.load_plugins_from_config()
        }
    }

    /// Load plugins embedded in the binary (locked mode)
    #[cfg(feature = "locked-plugins")]
    fn load_embedded_plugins(&mut self) -> Result<Vec<PluginInfo>> {
        log::info!("🔒 Loading embedded plugins (locked mode)");

        let mut plugins = Vec::new();

        for plugin in embedded::EMBEDDED_PLUGINS {
            log::info!("📦 Loading embedded plugin: {}", plugin.id);

            if plugin.is_dll {
                // For DLLs, we need to write to a temp file and load it
                // (libloading requires a file path)
                match self.load_embedded_dll(plugin.id, plugin.data) {
                    Ok(plugin_info) => plugins.push(plugin_info),
                    Err(e) => log::warn!("⚠️  Failed to load embedded plugin {}: {}", plugin.id, e),
                }
            } else {
                // JS plugin - store the data directly
                let js_content = String::from_utf8_lossy(plugin.data).to_string();
                crate::bridge::core::plugin_exports::register_embedded_js(plugin.id.to_string(), js_content);

                plugins.push(PluginInfo {
                    id: plugin.id.to_string(),
                    name: plugin.id.to_string(),
                    version: "1.0.0".to_string(),
                    description: String::new(),
                    author: String::new(),
                    dll_path: PathBuf::new(),
                    has_backend: false,
                    has_frontend: true,
                    priority: 100,
                    routes: vec![],
                    frontend_path: None,
                    embedded_js: Some(plugin.id.to_string()),
                });
                log::info!("✅ Loaded embedded JS plugin: {}", plugin.id);
            }
        }

        log::info!("📦 Successfully loaded {} embedded plugins", plugins.len());
        Ok(plugins)
    }

    /// Load a DLL from embedded bytes
    #[cfg(feature = "locked-plugins")]
    fn load_embedded_dll(&mut self, plugin_id: &str, data: &[u8]) -> Result<PluginInfo> {
        // Write DLL to temp directory
        let temp_dir = std::env::temp_dir().join("emils_plugins");
        fs::create_dir_all(&temp_dir)?;

        #[cfg(target_os = "windows")]
        let dll_name = format!("{}.dll", plugin_id);
        #[cfg(target_os = "linux")]
        let dll_name = format!("lib{}.so", plugin_id);
        #[cfg(target_os = "macos")]
        let dll_name = format!("lib{}.dylib", plugin_id);

        let dll_path = temp_dir.join(&dll_name);
        fs::write(&dll_path, data)?;

        self.load_plugin_from_dll(&dll_path, plugin_id)
    }

    /// Load plugins from config file (unlocked mode)
    #[cfg(not(feature = "locked-plugins"))]
    fn load_plugins_from_config(&mut self) -> Result<Vec<PluginInfo>> {
        log::info!("📋 Loading plugins from config: {:?}", self.config_path);

        // If config doesn't exist, return empty list
        if !self.config_path.exists() {
            log::info!("⚠️  Config file not found, no plugins to load");
            return Ok(Vec::new());
        }

        let config = WebArcadeConfig::load(&self.config_path)?;
        let mut plugins = Vec::new();

        // Filter enabled plugins
        let enabled_plugins: HashMap<String, PluginConfig> = config.plugins
            .into_iter()
            .filter(|(id, cfg)| {
                if !cfg.enabled {
                    log::info!("⏭️  Skipping disabled plugin: {}", id);
                    false
                } else {
                    true
                }
            })
            .collect();

        // Resolve load order using topological sort
        let load_order = self.resolve_plugin_dependencies(&enabled_plugins)?;
        log::info!("📋 Plugin load order: {:?}", load_order);

        for plugin_id in load_order {
            let plugin_config = enabled_plugins.get(&plugin_id).unwrap();

            log::info!("📦 Loading plugin from config: {}", plugin_id);

            if plugin_config.has_backend {
                // Load DLL plugin
                let dll_path = self.resolve_dll_path(&plugin_id);

                if dll_path.exists() {
                    match self.load_plugin_from_dll(&dll_path, &plugin_id) {
                        Ok(mut plugin_info) => {
                            // Override with config values
                            plugin_info.name = plugin_config.name.clone();
                            plugin_info.version = plugin_config.version.clone();
                            plugin_info.description = plugin_config.description.clone();
                            plugin_info.author = plugin_config.author.clone();
                            plugin_info.priority = plugin_config.priority;
                            plugins.push(plugin_info);
                        }
                        Err(e) => log::warn!("⚠️  Failed to load DLL plugin {}: {}", plugin_id, e),
                    }
                } else {
                    log::warn!("⚠️  DLL not found for plugin {}: {:?}", plugin_id, dll_path);
                }
            } else {
                // Frontend-only JS plugin
                let js_path = self.plugins_dir.join(&plugin_config.path);

                if js_path.exists() {
                    plugins.push(PluginInfo {
                        id: plugin_id.clone(),
                        name: plugin_config.name.clone(),
                        version: plugin_config.version.clone(),
                        description: plugin_config.description.clone(),
                        author: plugin_config.author.clone(),
                        dll_path: PathBuf::new(),
                        has_backend: false,
                        has_frontend: true,
                        priority: plugin_config.priority,
                        routes: vec![],
                        frontend_path: Some(js_path),
                        #[cfg(feature = "locked-plugins")]
                        embedded_js: None,
                    });
                    log::info!("✅ Loaded frontend plugin: {}", plugin_id);
                } else {
                    log::warn!("⚠️  JS file not found for plugin {}: {:?}", plugin_id, js_path);
                }
            }
        }

        log::info!("📦 Successfully loaded {} plugins from config", plugins.len());
        Ok(plugins)
    }

    /// Resolve plugin load order using topological sort based on dependencies.
    /// Uses priority as a tiebreaker when plugins have no dependency relationship.
    fn resolve_plugin_dependencies(&self, plugins: &HashMap<String, PluginConfig>) -> Result<Vec<String>> {
        let mut order = Vec::new();
        let mut visited = HashSet::new();
        let mut visiting = HashSet::new();

        // Validate all dependencies exist
        for (plugin_id, config) in plugins {
            for dep in &config.dependencies {
                if !plugins.contains_key(dep) {
                    return Err(anyhow!(
                        "Plugin '{}' depends on '{}' which is not registered or enabled",
                        plugin_id, dep
                    ));
                }
            }
        }

        // Sort by priority first so tiebreaking is deterministic
        let mut plugin_ids: Vec<_> = plugins.keys().cloned().collect();
        plugin_ids.sort_by(|a, b| {
            plugins.get(a).unwrap().priority.cmp(&plugins.get(b).unwrap().priority)
        });

        // Topological sort with DFS
        for plugin_id in &plugin_ids {
            if !visited.contains(plugin_id) {
                self.visit_plugin_deps(
                    plugin_id,
                    plugins,
                    &mut order,
                    &mut visited,
                    &mut visiting,
                )?;
            }
        }

        Ok(order)
    }

    fn visit_plugin_deps(
        &self,
        plugin_id: &str,
        plugins: &HashMap<String, PluginConfig>,
        order: &mut Vec<String>,
        visited: &mut HashSet<String>,
        visiting: &mut HashSet<String>,
    ) -> Result<()> {
        if visited.contains(plugin_id) {
            return Ok(());
        }

        if visiting.contains(plugin_id) {
            return Err(anyhow!("Circular dependency detected involving plugin '{}'", plugin_id));
        }

        visiting.insert(plugin_id.to_string());

        if let Some(config) = plugins.get(plugin_id) {
            // Sort dependencies by priority for consistent ordering
            let mut deps: Vec<_> = config.dependencies.iter().cloned().collect();
            deps.sort_by(|a, b| {
                let priority_a = plugins.get(a).map(|c| c.priority).unwrap_or(100);
                let priority_b = plugins.get(b).map(|c| c.priority).unwrap_or(100);
                priority_a.cmp(&priority_b)
            });

            for dep in deps {
                self.visit_plugin_deps(&dep, plugins, order, visited, visiting)?;
            }
        }

        visiting.remove(plugin_id);
        visited.insert(plugin_id.to_string());
        order.push(plugin_id.to_string());

        Ok(())
    }

    /// Resolve DLL path for a plugin
    fn resolve_dll_path(&self, plugin_id: &str) -> PathBuf {
        #[cfg(target_os = "windows")]
        let dll_name = format!("{}.dll", plugin_id);
        #[cfg(target_os = "linux")]
        let dll_name = format!("lib{}.so", plugin_id);
        #[cfg(target_os = "macos")]
        let dll_name = format!("lib{}.dylib", plugin_id);

        self.plugins_dir.join(&dll_name)
    }

    fn load_plugin_from_dll(&mut self, dll_path: &Path, plugin_id: &str) -> Result<PluginInfo> {
        log::info!("📦 Loading plugin DLL: {} from {:?}", plugin_id, dll_path);

        // Load the library
        let lib = unsafe { Library::new(dll_path)? };
        let lib_arc = Arc::new(lib);

        // Get manifest from the DLL
        let manifest = self.get_manifest_from_dll(&lib_arc)?;
        let webarcade_config = manifest.get("webarcade")
            .ok_or_else(|| anyhow!("Manifest missing 'webarcade' section"))?;

        let routes = webarcade_config.get("routes")
            .and_then(|r| r.as_array())
            .cloned()
            .unwrap_or_default();

        // Check if plugin has frontend
        let has_frontend = self.check_has_frontend(&lib_arc);

        // Plugin has backend if it has any routes
        let has_backend = !routes.is_empty();

        // Register the plugin library for FFI calls
        crate::bridge::core::plugin_exports::register_plugin_library(plugin_id.to_string(), lib_arc);

        let plugin_type = if has_backend { "full-stack" } else { "frontend-only" };
        log::info!("✅ Loaded {} plugin: {} ({} routes, frontend: {})", plugin_type, plugin_id, routes.len(), has_frontend);

        Ok(PluginInfo {
            id: plugin_id.to_string(),
            name: plugin_id.to_string(),
            version: "1.0.0".to_string(),
            description: String::new(),
            author: String::new(),
            dll_path: dll_path.to_path_buf(),
            has_backend,
            has_frontend,
            priority: 100,
            routes,
            frontend_path: None,
            #[cfg(feature = "locked-plugins")]
            embedded_js: None,
        })
    }

    fn get_manifest_from_dll(&self, lib: &Arc<Library>) -> Result<serde_json::Value> {
        type GetManifestFn = unsafe extern "C" fn() -> *const u8;
        type GetManifestLenFn = unsafe extern "C" fn() -> usize;

        unsafe {
            let get_manifest: libloading::Symbol<GetManifestFn> = lib.get(b"get_plugin_manifest")?;
            let get_manifest_len: libloading::Symbol<GetManifestLenFn> = lib.get(b"get_plugin_manifest_len")?;

            let ptr = get_manifest();
            let len = get_manifest_len();

            if ptr.is_null() || len == 0 {
                return Err(anyhow!("Plugin returned null/empty manifest"));
            }

            let slice = std::slice::from_raw_parts(ptr, len);
            let manifest_str = std::str::from_utf8(slice)?;
            let manifest: serde_json::Value = serde_json::from_str(manifest_str)?;

            Ok(manifest)
        }
    }

    fn check_has_frontend(&self, lib: &Arc<Library>) -> bool {
        type HasFrontendFn = unsafe extern "C" fn() -> bool;

        unsafe {
            if let Ok(has_frontend) = lib.get::<HasFrontendFn>(b"has_frontend") {
                has_frontend()
            } else {
                false
            }
        }
    }

    /// Get frontend JavaScript from a loaded plugin
    pub fn get_frontend_js(plugin_id: &str) -> Result<String> {
        type GetFrontendFn = unsafe extern "C" fn() -> *const u8;
        type GetFrontendLenFn = unsafe extern "C" fn() -> usize;

        let lib = crate::bridge::core::plugin_exports::get_plugin_library(plugin_id)
            .ok_or_else(|| anyhow!("Plugin not loaded: {}", plugin_id))?;

        unsafe {
            let get_frontend: libloading::Symbol<GetFrontendFn> = lib.get(b"get_plugin_frontend")?;
            let get_frontend_len: libloading::Symbol<GetFrontendLenFn> = lib.get(b"get_plugin_frontend_len")?;

            let ptr = get_frontend();
            let len = get_frontend_len();

            if ptr.is_null() || len == 0 {
                return Err(anyhow!("Plugin has no frontend"));
            }

            let slice = std::slice::from_raw_parts(ptr, len);
            let frontend_str = std::str::from_utf8(slice)?;

            Ok(frontend_str.to_string())
        }
    }

    /// Get the config path being used
    pub fn config_path(&self) -> &Path {
        &self.config_path
    }
}

/// Information about a loaded plugin
#[derive(Debug, Clone)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub dll_path: PathBuf,
    pub has_backend: bool,
    pub has_frontend: bool,
    pub priority: i32,
    pub routes: Vec<serde_json::Value>,
    /// Path to plugin.js for frontend-only plugins (no DLL)
    pub frontend_path: Option<PathBuf>,
    /// Key for embedded JS content (locked-plugins mode)
    #[cfg(feature = "locked-plugins")]
    pub embedded_js: Option<String>,
}
