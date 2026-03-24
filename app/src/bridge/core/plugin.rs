use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use anyhow::Result;
use std::sync::Arc;
use crate::bridge::core::plugin_context::PluginContext;

/// Plugin metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginMetadata {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub dependencies: Vec<String>,  // Other plugin IDs this depends on
}

/// Plugin lifecycle trait - all plugins must implement this
#[async_trait]
pub trait Plugin: Send + Sync {
    /// Get plugin metadata
    fn metadata(&self) -> PluginMetadata;

    /// Initialize plugin (run migrations, register services, set up routes)
    /// Called once during server startup, before start()
    async fn init(&self, ctx: &PluginContext) -> Result<()> {
        Ok(())
    }

    /// Start plugin (begin background tasks, subscribe to events, connect to external services)
    /// Called after all plugins have been initialized
    async fn start(&self, ctx: Arc<PluginContext>) -> Result<()> {
        Ok(())
    }

    /// Stop plugin (cleanup, disconnect)
    /// Called during server shutdown
    async fn stop(&self) -> Result<()> {
        Ok(())
    }

    /// Health check (optional)
    async fn health_check(&self) -> Result<()> {
        Ok(())
    }
}
