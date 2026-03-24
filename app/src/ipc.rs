//! IPC module for additional IPC functionality
//!
//! Most IPC is handled directly in main.rs via custom protocol.
//! This module can be extended for more complex IPC needs.

use serde::Serialize;

/// Event that can be emitted to the frontend
#[derive(Debug, Clone, Serialize)]
pub struct FrontendEvent {
    pub event: String,
    pub payload: serde_json::Value,
}

/// Emit an event to the frontend via webview
/// Call webview.evaluate_script() with this to send events
pub fn emit_event_script(event: &str, payload: &serde_json::Value) -> String {
    let payload_str = serde_json::to_string(payload).unwrap_or_default();
    format!(
        r#"
        if (window.__WEBARCADE__ && window.__WEBARCADE__.event) {{
            window.__WEBARCADE__.event.emit('{}', {});
        }}
        "#,
        event,
        payload_str
    )
}

/// Events emitted by the app
pub mod events {
    /// Emitted when window close is requested (for save prompts)
    pub const CLOSE_REQUESTED: &str = "window-close-requested";

    /// Emitted when the app is ready
    pub const APP_READY: &str = "app-ready";

    /// Emitted to proceed with close after save
    pub const PROCEED_CLOSE: &str = "proceed-with-close";
}
