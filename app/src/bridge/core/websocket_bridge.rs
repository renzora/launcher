use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, tungstenite::Message};
use futures_util::{StreamExt, SinkExt};
use std::sync::Arc;
use tokio::sync::broadcast;
use anyhow::Result;

use super::EventBus;

/// WebSocket bridge that forwards plugin events to connected WebSocket clients
pub struct WebSocketBridge {
    event_bus: Arc<EventBus>,
}

impl WebSocketBridge {
    pub fn new(event_bus: Arc<EventBus>) -> Self {
        Self { event_bus }
    }

    pub async fn start(&self, port: String) -> Result<()> {
        let addr = format!("127.0.0.1:{}", port);
        let listener = TcpListener::bind(&addr).await?;
        log::info!("📡 WebSocket server listening on ws://{}", addr);

        // Subscribe to ALL events from the event bus
        let mut global_events = self.event_bus.subscribe();

        // Broadcast channel for WebSocket clients
        let (ws_tx, _) = broadcast::channel::<String>(1000);
        let ws_tx = Arc::new(ws_tx);

        // Spawn task to forward plugin events to WebSocket broadcast channel
        let ws_tx_clone = ws_tx.clone();
        tokio::spawn(async move {
            while let Ok(event) = global_events.recv().await {
                // Serialize event to JSON
                if let Ok(json) = serde_json::to_string(&event) {
                    // Broadcast to all WebSocket clients
                    let _ = ws_tx_clone.send(json);
                }
            }
        });

        // Accept WebSocket connections
        loop {
            match listener.accept().await {
                Ok((stream, addr)) => {
                    log::debug!("WebSocket connection from: {}", addr);
                    let ws_rx = ws_tx.subscribe();

                    tokio::spawn(async move {
                        if let Err(e) = handle_websocket_client(stream, ws_rx).await {
                            log::error!("WebSocket client error: {}", e);
                        }
                    });
                }
                Err(e) => {
                    log::error!("Failed to accept WebSocket connection: {}", e);
                }
            }
        }
    }
}

async fn handle_websocket_client(
    stream: tokio::net::TcpStream,
    mut ws_rx: broadcast::Receiver<String>,
) -> Result<()> {
    let ws_stream = accept_async(stream).await?;
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Send welcome message
    let welcome_msg = serde_json::json!({
        "type": "connected",
        "system": "plugin-based",
        "message": "WebArcade Bridge - Plugin Event Stream"
    });

    ws_sender.send(Message::Text(welcome_msg.to_string())).await?;

    loop {
        tokio::select! {
            // Forward plugin events to this WebSocket client
            Ok(event_json) = ws_rx.recv() => {
                if let Err(e) = ws_sender.send(Message::Text(event_json)).await {
                    log::debug!("Failed to send to WebSocket client: {}", e);
                    break;
                }
            }

            // Handle incoming WebSocket messages (mostly for ping/pong)
            msg = ws_receiver.next() => {
                match msg {
                    Some(Ok(Message::Close(_))) => {
                        log::debug!("WebSocket client closed connection");
                        break;
                    }
                    Some(Ok(Message::Ping(data))) => {
                        ws_sender.send(Message::Pong(data)).await?;
                    }
                    Some(Ok(Message::Text(text))) => {
                        // Could handle client requests here if needed
                        log::debug!("WebSocket received: {}", text);
                    }
                    Some(Err(e)) => {
                        log::error!("WebSocket error: {}", e);
                        break;
                    }
                    None => {
                        log::debug!("WebSocket stream ended");
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    Ok(())
}
