/// Macro to simplify plugin metadata creation
///
/// Usage:
/// ```
/// impl Plugin for MyPlugin {
///     plugin_metadata!("my-plugin", "My Plugin", "1.0.0", "Plugin description");
///     // or with dependencies:
///     plugin_metadata!("my-plugin", "My Plugin", "1.0.0", "Plugin description", deps: ["other-plugin"]);
/// }
/// ```
#[macro_export]
macro_rules! plugin_metadata {
    ($id:expr, $name:expr, $version:expr, $description:expr) => {
        fn metadata(&self) -> $crate::core::plugin::PluginMetadata {
            $crate::core::plugin::PluginMetadata {
                id: $id.to_string(),
                name: $name.to_string(),
                version: $version.to_string(),
                description: $description.to_string(),
                author: "WebArcade Team".to_string(),
                dependencies: vec![],
            }
        }
    };
    ($id:expr, $name:expr, $version:expr, $description:expr, author: $author:expr) => {
        fn metadata(&self) -> $crate::core::plugin::PluginMetadata {
            $crate::core::plugin::PluginMetadata {
                id: $id.to_string(),
                name: $name.to_string(),
                version: $version.to_string(),
                description: $description.to_string(),
                author: $author.to_string(),
                dependencies: vec![],
            }
        }
    };
    ($id:expr, $name:expr, $version:expr, $description:expr, deps: [$($dep:expr),*]) => {
        fn metadata(&self) -> $crate::core::plugin::PluginMetadata {
            $crate::core::plugin::PluginMetadata {
                id: $id.to_string(),
                name: $name.to_string(),
                version: $version.to_string(),
                description: $description.to_string(),
                author: "WebArcade Team".to_string(),
                dependencies: vec![$($dep.to_string()),*],
            }
        }
    };
    ($id:expr, $name:expr, $version:expr, $description:expr, author: $author:expr, deps: [$($dep:expr),*]) => {
        fn metadata(&self) -> $crate::core::plugin::PluginMetadata {
            $crate::core::plugin::PluginMetadata {
                id: $id.to_string(),
                name: $name.to_string(),
                version: $version.to_string(),
                description: $description.to_string(),
                author: $author.to_string(),
                dependencies: vec![$($dep.to_string()),*],
            }
        }
    };
}

/// Macro to simplify route registration
///
/// Usage:
/// ```
/// route!(router, GET "/path" => handler_function);
/// route!(router, POST "/path" => handler_function);
/// route!(router, GET "/path", query => handler_with_query);
/// route!(router, GET "/path", path => handler_with_path);
/// route!(router, GET "/path", path, query => handler_with_both);
/// ```
#[macro_export]
macro_rules! route {
    ($router:expr, GET $path:expr => $handler:expr) => {
        $router.route(hyper::Method::GET, $path, |_path, _query, _req| {
            Box::pin(async move { $handler().await })
        });
    };
    ($router:expr, POST $path:expr => $handler:expr) => {
        $router.route(hyper::Method::POST, $path, |_path, _query, req| {
            Box::pin(async move { $handler(req).await })
        });
    };
    ($router:expr, PUT $path:expr => $handler:expr) => {
        $router.route(hyper::Method::PUT, $path, |_path, _query, req| {
            Box::pin(async move { $handler(req).await })
        });
    };
    ($router:expr, DELETE $path:expr => $handler:expr) => {
        $router.route(hyper::Method::DELETE, $path, |_path, _query, _req| {
            Box::pin(async move { $handler().await })
        });
    };
    ($router:expr, OPTIONS $path:expr => $handler:expr) => {
        $router.route(hyper::Method::OPTIONS, $path, |_path, _query, _req| {
            Box::pin(async move { $handler().await })
        });
    };
    ($router:expr, GET $path:expr, query => $handler:expr) => {
        $router.route(hyper::Method::GET, $path, |_path, query, _req| {
            Box::pin(async move { $handler(query).await })
        });
    };
    ($router:expr, POST $path:expr, query => $handler:expr) => {
        $router.route(hyper::Method::POST, $path, |_path, query, req| {
            Box::pin(async move { $handler(query, req).await })
        });
    };
    ($router:expr, GET $path:expr, path => $handler:expr) => {
        $router.route(hyper::Method::GET, $path, |path, _query, _req| {
            Box::pin(async move { $handler(path).await })
        });
    };
    ($router:expr, DELETE $path:expr, path => $handler:expr) => {
        $router.route(hyper::Method::DELETE, $path, |path, _query, _req| {
            Box::pin(async move { $handler(path).await })
        });
    };
    ($router:expr, GET $path:expr, path, query => $handler:expr) => {
        $router.route(hyper::Method::GET, $path, |path, query, _req| {
            Box::pin(async move { $handler(path, query).await })
        });
    };
    ($router:expr, POST $path:expr, path, query => $handler:expr) => {
        $router.route(hyper::Method::POST, $path, |path, query, req| {
            Box::pin(async move { $handler(path, query, req).await })
        });
    };
    ($router:expr, POST $path:expr, path => $handler:expr) => {
        $router.route(hyper::Method::POST, $path, |path, _query, req| {
            Box::pin(async move { $handler(path, req).await })
        });
    };
    ($router:expr, PUT $path:expr, path => $handler:expr) => {
        $router.route(hyper::Method::PUT, $path, |path, _query, req| {
            Box::pin(async move { $handler(path, req).await })
        });
    };
}
