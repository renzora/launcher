// Export functions that dynamic plugins will call
// These are the implementations that webarcade_api::Context calls

use crate::bridge::core::plugin_context::PluginContext;
use std::collections::HashMap;
use std::sync::{Mutex, Arc};
use once_cell::sync::Lazy;
use libloading::Library;
use tokio::runtime::Runtime;

// Global registry to track plugin_id -> Library mapping
pub static PLUGIN_LIBRARIES: Lazy<Mutex<HashMap<String, Arc<Library>>>> = Lazy::new(|| Mutex::new(HashMap::new()));

// Global registry for embedded JS content (locked-plugins mode)
#[cfg(feature = "locked-plugins")]
pub static EMBEDDED_JS: Lazy<Mutex<HashMap<String, String>>> = Lazy::new(|| Mutex::new(HashMap::new()));

// Global router registry for dynamic plugin route registration
pub static GLOBAL_ROUTER_REGISTRY: Lazy<Mutex<Option<crate::bridge::core::plugin_router::RouterRegistry>>> = Lazy::new(|| Mutex::new(None));

// Shared tokio runtime for all DLL plugins
pub static SHARED_RUNTIME: Lazy<Arc<Runtime>> = Lazy::new(|| {
    Arc::new(
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .worker_threads(4)
            .thread_name("webarcade-plugin")
            .build()
            .expect("Failed to create shared plugin runtime")
    )
});

/// Get pointer to the shared runtime for passing to DLL handlers
pub fn get_shared_runtime_ptr() -> *const () {
    Arc::as_ptr(&SHARED_RUNTIME) as *const ()
}

/// Register a plugin library for handler lookups
pub fn register_plugin_library(plugin_id: String, library: Arc<Library>) {
    let mut libs = PLUGIN_LIBRARIES.lock().unwrap();
    libs.insert(plugin_id, library);
}

/// Unload a plugin library (removes from registry and drops the library handle)
pub fn unload_plugin_library(plugin_id: &str) -> bool {
    let mut libs = PLUGIN_LIBRARIES.lock().unwrap();
    if libs.remove(plugin_id).is_some() {
        log::info!("[FFI] Unloaded plugin library: {}", plugin_id);
        true
    } else {
        false
    }
}

/// Get a reference to a plugin library by ID
pub fn get_plugin_library(plugin_id: &str) -> Option<Arc<Library>> {
    let libs = PLUGIN_LIBRARIES.lock().unwrap();
    libs.get(plugin_id).cloned()
}

/// Register embedded JS content (locked-plugins mode)
#[cfg(feature = "locked-plugins")]
pub fn register_embedded_js(plugin_id: String, content: String) {
    let mut js = EMBEDDED_JS.lock().unwrap();
    js.insert(plugin_id, content);
}

/// Get embedded JS content by plugin ID (locked-plugins mode)
#[cfg(feature = "locked-plugins")]
pub fn get_embedded_js(plugin_id: &str) -> Option<String> {
    let js = EMBEDDED_JS.lock().unwrap();
    js.get(plugin_id).cloned()
}

/// Set the global router registry (called during bridge startup)
pub fn set_global_router_registry(registry: crate::bridge::core::plugin_router::RouterRegistry) {
    let mut global = GLOBAL_ROUTER_REGISTRY.lock().unwrap();
    *global = Some(registry);
}

/// Get a clone of the global router registry
pub fn get_global_router_registry() -> Option<crate::bridge::core::plugin_router::RouterRegistry> {
    let global = GLOBAL_ROUTER_REGISTRY.lock().unwrap();
    global.clone()
}

/// Emit an event
#[no_mangle]
pub extern "C" fn webarcade_emit_event(
    ctx: *const (),
    event_name: *const u8,
    event_name_len: usize,
    data: *const u8,
    data_len: usize
) {
    unsafe {
        let ctx = &*(ctx as *const PluginContext);
        let event_name_slice = std::slice::from_raw_parts(event_name, event_name_len);
        let event_name_str = match std::str::from_utf8(event_name_slice) {
            Ok(s) => s,
            Err(_) => return,
        };
        let data_slice = std::slice::from_raw_parts(data, data_len);
        let data_str = match std::str::from_utf8(data_slice) {
            Ok(s) => s,
            Err(_) => return,
        };

        let json_data: serde_json::Value = match serde_json::from_str(data_str) {
            Ok(v) => v,
            Err(_) => return,
        };

        ctx.emit(event_name_str, &json_data);
    }
}
