use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use anyhow::{Result, anyhow};
use crate::bridge::core::plugin::{Plugin, PluginMetadata};
use crate::bridge::core::plugin_context::PluginContext;
use crate::bridge::core::events::EventBus;
use crate::bridge::core::services::ServiceRegistry;
use crate::bridge::core::plugin_router::RouterRegistry;

pub struct PluginManager {
    plugins: HashMap<String, Box<dyn Plugin>>,
    contexts: HashMap<String, Arc<PluginContext>>,
    event_bus: Arc<EventBus>,
    service_registry: Arc<ServiceRegistry>,
    router_registry: RouterRegistry,
    db_path: String,
}

impl PluginManager {
    pub fn new(
        event_bus: Arc<EventBus>,
        service_registry: Arc<ServiceRegistry>,
        router_registry: RouterRegistry,
        db_path: String,
    ) -> Self {
        Self {
            plugins: HashMap::new(),
            contexts: HashMap::new(),
            event_bus,
            service_registry,
            router_registry,
            db_path,
        }
    }

    pub fn register<P: Plugin + 'static>(&mut self, plugin: P) {
        let metadata = plugin.metadata();
        let plugin_id = metadata.id.clone();

        let ctx = Arc::new(PluginContext::new(
            plugin_id.clone(),
            self.event_bus.clone(),
            self.service_registry.clone(),
            self.router_registry.clone_registry(),
            self.db_path.clone(),
        ));

        self.contexts.insert(plugin_id.clone(), ctx);
        self.plugins.insert(plugin_id, Box::new(plugin));
    }

    pub async fn init_all(&self) -> Result<()> {
        let load_order = self.resolve_dependencies()?;

        for plugin_id in &load_order {
            if let (Some(plugin), Some(ctx)) = (
                self.plugins.get(plugin_id),
                self.contexts.get(plugin_id)
            ) {
                plugin.init(ctx).await.map_err(|e| {
                    anyhow!("Failed to initialize plugin '{}': {}", plugin_id, e)
                })?;
            }
        }

        Ok(())
    }

    pub async fn start_all(&self) -> Result<()> {
        let load_order = self.resolve_dependencies()?;

        for plugin_id in &load_order {
            if let (Some(plugin), Some(ctx)) = (
                self.plugins.get(plugin_id),
                self.contexts.get(plugin_id)
            ) {
                plugin.start(ctx.clone()).await.map_err(|e| {
                    anyhow!("Failed to start plugin '{}': {}", plugin_id, e)
                })?;
            }
        }

        Ok(())
    }

    pub fn list_plugins(&self) -> Vec<PluginMetadata> {
        self.plugins.values().map(|p| p.metadata()).collect()
    }

    fn resolve_dependencies(&self) -> Result<Vec<String>> {
        let mut order = Vec::new();
        let mut visited = HashSet::new();
        let mut visiting = HashSet::new();

        for plugin_id in self.plugins.keys() {
            if !visited.contains(plugin_id) {
                self.visit_plugin(plugin_id, &mut order, &mut visited, &mut visiting)?;
            }
        }

        Ok(order)
    }

    fn visit_plugin(
        &self,
        plugin_id: &str,
        order: &mut Vec<String>,
        visited: &mut HashSet<String>,
        visiting: &mut HashSet<String>,
    ) -> Result<()> {
        if visited.contains(plugin_id) {
            return Ok(());
        }

        if visiting.contains(plugin_id) {
            return Err(anyhow!("Circular dependency detected: {}", plugin_id));
        }

        visiting.insert(plugin_id.to_string());

        if let Some(plugin) = self.plugins.get(plugin_id) {
            for dep in &plugin.metadata().dependencies {
                if !self.plugins.contains_key(dep) {
                    return Err(anyhow!("Plugin '{}' depends on unregistered '{}'", plugin_id, dep));
                }
                self.visit_plugin(dep, order, visited, visiting)?;
            }
        }

        visiting.remove(plugin_id);
        visited.insert(plugin_id.to_string());
        order.push(plugin_id.to_string());

        Ok(())
    }
}
