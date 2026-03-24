use hyper::{Method, Request, Response, StatusCode, body::Incoming};
use http_body_util::{combinators::BoxBody, Full, BodyExt};
use hyper::body::Bytes;
use std::convert::Infallible;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub type RouteHandler = Box<dyn Fn(String, String, Request<Incoming>) -> BoxFuture<Response<BoxBody<Bytes, Infallible>>> + Send + Sync>;
pub type BoxFuture<T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send>>;

/// A router for a specific plugin
pub struct PluginRouter {
    routes: HashMap<(Method, String), RouteHandler>,
}

impl PluginRouter {
    pub fn new() -> Self {
        Self {
            routes: HashMap::new(),
        }
    }

    /// Register a route handler
    pub fn route<F>(&mut self, method: Method, path: &str, handler: F)
    where
        F: Fn(String, String, Request<Incoming>) -> BoxFuture<Response<BoxBody<Bytes, Infallible>>> + Send + Sync + 'static,
    {
        self.routes.insert((method, path.to_string()), Box::new(handler));
    }

    /// Handle a request for this plugin
    pub async fn handle(
        &self,
        method: &Method,
        path: &str,
        query: &str,
        req: Request<Incoming>,
    ) -> Option<Response<BoxBody<Bytes, Infallible>>> {
        // Automatically handle OPTIONS (CORS preflight) requests for all routes
        if method == Method::OPTIONS {
            return Some(cors_preflight_response());
        }

        // Try exact match first
        if let Some(handler) = self.routes.get(&(method.clone(), path.to_string())) {
            return Some(handler(path.to_string(), query.to_string(), req).await);
        }

        // Try pattern matching for dynamic routes
        for ((route_method, route_path), handler) in &self.routes {
            if route_method == method {
                // Check if it's a wildcard match
                if route_path.ends_with("/*") {
                    let prefix = &route_path[..route_path.len() - 2];
                    if path.starts_with(prefix) {
                        return Some(handler(path.to_string(), query.to_string(), req).await);
                    }
                }
                // Check if it's a parameter match (e.g., "/user/:id")
                if route_path.contains("/:") {
                    if paths_match(route_path, path) {
                        return Some(handler(path.to_string(), query.to_string(), req).await);
                    }
                }
            }
        }

        None
    }
}

/// Check if a path matches a route pattern
fn paths_match(pattern: &str, path: &str) -> bool {
    let pattern_parts: Vec<&str> = pattern.split('/').collect();
    let path_parts: Vec<&str> = path.split('/').collect();

    if pattern_parts.len() != path_parts.len() {
        return false;
    }

    for (pattern_part, path_part) in pattern_parts.iter().zip(path_parts.iter()) {
        if pattern_part.starts_with(':') {
            // This is a parameter, matches anything
            continue;
        }
        if pattern_part != path_part {
            return false;
        }
    }

    true
}

/// Create a CORS preflight response
fn cors_preflight_response() -> Response<BoxBody<Bytes, Infallible>> {
    Response::builder()
        .status(StatusCode::OK)
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        .header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        .header("Access-Control-Max-Age", "86400")
        .body(BoxBody::new(Full::new(Bytes::from("")).map_err(|err: Infallible| match err {})))
        .unwrap()
}

/// Registry for all plugin routers
#[derive(Clone)]
pub struct RouterRegistry {
    routers: Arc<RwLock<HashMap<String, PluginRouter>>>,
}

impl RouterRegistry {
    pub fn new() -> Self {
        Self {
            routers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a router for a plugin
    pub async fn register(&self, plugin_name: String, router: PluginRouter) {
        let mut routers = self.routers.write().await;
        routers.insert(plugin_name, router);
    }

    /// Route a request to the appropriate plugin router
    pub async fn route(
        &self,
        plugin_name: &str,
        method: &Method,
        path: &str,
        query: &str,
        req: Request<Incoming>,
    ) -> Option<Response<BoxBody<Bytes, Infallible>>> {
        let routers = self.routers.read().await;
        if let Some(router) = routers.get(plugin_name) {
            router.handle(method, path, query, req).await
        } else {
            None
        }
    }

    pub fn clone_registry(&self) -> Self {
        Self {
            routers: Arc::clone(&self.routers),
        }
    }
}
