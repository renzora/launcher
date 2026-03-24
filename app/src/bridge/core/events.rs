use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Generic event wrapper - core knows nothing about event contents
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    /// Plugin that emitted this event
    pub source_plugin: String,

    /// Event type identifier (e.g., "auction.bid_placed", "twitch.chat_message")
    pub event_type: String,

    /// Timestamp (Unix seconds)
    pub timestamp: i64,

    /// Event payload (plugins deserialize this themselves)
    pub payload: Value,
}

/// Event bus - completely generic, knows nothing about specific events
pub struct EventBus {
    /// Global broadcast channel for all events
    sender: broadcast::Sender<Event>,

    /// Typed channels for specific event types (optional, for performance)
    typed_channels: Arc<RwLock<HashMap<String, broadcast::Sender<Event>>>>,
}

impl EventBus {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(1000);
        Self {
            sender,
            typed_channels: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Publish event to all subscribers
    pub fn publish(&self, event: Event) {
        let _ = self.sender.send(event.clone());

        // Also send to typed channel if it exists
        if let Ok(channels) = self.typed_channels.try_read() {
            if let Some(typed_sender) = channels.get(&event.event_type) {
                let _ = typed_sender.send(event);
            }
        }
    }

    /// Subscribe to ALL events
    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.sender.subscribe()
    }

    /// Subscribe to specific event type (e.g., "auction.bid_placed")
    pub async fn subscribe_to(&self, event_type: &str) -> broadcast::Receiver<Event> {
        let mut channels = self.typed_channels.write().await;

        let sender = channels.entry(event_type.to_string())
            .or_insert_with(|| {
                let (tx, _) = broadcast::channel(100);
                tx
            });

        sender.subscribe()
    }

    /// Helper to publish typed events (used by plugins)
    pub fn publish_typed<T: Serialize>(&self, source_plugin: &str, event_type: &str, payload: &T) {
        let event = Event {
            source_plugin: source_plugin.to_string(),
            event_type: event_type.to_string(),
            timestamp: current_timestamp(),
            payload: serde_json::to_value(payload).unwrap_or(Value::Null),
        };
        self.publish(event);
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

fn current_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}
