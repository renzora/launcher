use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::RwLock;
use serde_json::Value;
use anyhow::Result;

/// A service method signature - takes JSON input, returns JSON output
pub type ServiceMethod = Arc<dyn Fn(Value) -> BoxFuture<'static, Result<Value>> + Send + Sync>;

/// Helper type for boxed futures
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Service registry - plugins register services, other plugins call them
pub struct ServiceRegistry {
    services: Arc<RwLock<HashMap<String, ServiceMethod>>>,
}

impl ServiceRegistry {
    pub fn new() -> Self {
        Self {
            services: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a service method
    /// service_id format: "plugin_name.method_name" (e.g., "auction.create_auction")
    pub async fn register<F, Fut>(&self, service_id: &str, handler: F)
    where
        F: Fn(Value) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<Value>> + Send + 'static,
    {
        let handler = Arc::new(move |input: Value| -> BoxFuture<'static, Result<Value>> {
            Box::pin(handler(input))
        });

        self.services.write().await.insert(service_id.to_string(), handler);
    }

    /// Call a service method
    pub async fn call(&self, service_id: &str, input: Value) -> Result<Value> {
        let services = self.services.read().await;

        if let Some(handler) = services.get(service_id) {
            let handler = handler.clone();
            drop(services); // Release lock before calling handler
            handler(input).await
        } else {
            Err(anyhow::anyhow!("Service not found: {}", service_id))
        }
    }

    /// Check if service exists
    pub async fn has_service(&self, service_id: &str) -> bool {
        self.services.read().await.contains_key(service_id)
    }

    /// List all registered services
    pub async fn list_services(&self) -> Vec<String> {
        self.services.read().await.keys().cloned().collect()
    }
}

impl Default for ServiceRegistry {
    fn default() -> Self {
        Self::new()
    }
}
