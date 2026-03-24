use std::sync::Arc;
use std::future::Future;
use anyhow::Result;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::broadcast;
use crate::bridge::core::events::{Event, EventBus};
use crate::bridge::core::services::ServiceRegistry;
use crate::bridge::core::plugin_router::{PluginRouter, RouterRegistry};

/// Plugin context - API provided to plugins
#[derive(Clone)]
pub struct PluginContext {
    plugin_id: String,
    event_bus: Arc<EventBus>,
    service_registry: Arc<ServiceRegistry>,
    router_registry: RouterRegistry,
}

impl PluginContext {
    pub fn new(
        plugin_id: String,
        event_bus: Arc<EventBus>,
        service_registry: Arc<ServiceRegistry>,
        router_registry: RouterRegistry,
        _db_path: String, // Keep for API compatibility but unused
    ) -> Self {
        Self {
            plugin_id,
            event_bus,
            service_registry,
            router_registry,
        }
    }

    /// Get plugin ID
    pub fn plugin_id(&self) -> &str {
        &self.plugin_id
    }

    // ==================== Events ====================

    /// Publish event
    pub fn emit<T: Serialize>(&self, event_type: &str, payload: &T) {
        self.event_bus.publish_typed(&self.plugin_id, event_type, payload);
    }

    /// Subscribe to specific event type
    pub async fn subscribe_to(&self, event_type: &str) -> broadcast::Receiver<Event> {
        self.event_bus.subscribe_to(event_type).await
    }

    /// Subscribe to all events
    pub fn subscribe_all(&self) -> broadcast::Receiver<Event> {
        self.event_bus.subscribe()
    }

    // ==================== Services ====================

    /// Register a service method that other plugins can call
    pub async fn provide_service<F, Fut>(&self, method_name: &str, handler: F)
    where
        F: Fn(Value) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<Value>> + Send + 'static,
    {
        let service_id = format!("{}.{}", self.plugin_id, method_name);
        self.service_registry.register(&service_id, handler).await;
    }

    /// Call another plugin's service
    pub async fn call_service(&self, plugin_id: &str, method: &str, input: Value) -> Result<Value> {
        let service_id = format!("{}.{}", plugin_id, method);
        self.service_registry.call(&service_id, input).await
    }

    /// Check if a service exists
    pub async fn has_service(&self, plugin_id: &str, method: &str) -> bool {
        let service_id = format!("{}.{}", plugin_id, method);
        self.service_registry.has_service(&service_id).await
    }

    /// List all available services
    pub async fn list_services(&self) -> Vec<String> {
        self.service_registry.list_services().await
    }

    // ==================== Routing ====================

    /// Register HTTP routes for this plugin
    pub async fn register_router(&self, plugin_name: &str, router: PluginRouter) {
        self.router_registry.register(plugin_name.to_string(), router).await;
    }

    /// Get the router registry
    pub fn router_registry(&self) -> &RouterRegistry {
        &self.router_registry
    }
}
