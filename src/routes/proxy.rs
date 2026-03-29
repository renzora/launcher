use webarcade::{Request, Response};
use crate::config;

/// Proxy a request to renzora.com/api/*
/// The frontend passes the API path and optional auth token in the request body
pub fn handle_proxy(req: Request) -> Response {
    let body: serde_json::Value = match req.json() {
        Ok(v) => v,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("Invalid request: {}", e) })),
    };

    let path = match body.get("path").and_then(|v| v.as_str()) {
        Some(p) => p.to_string(),
        None => return Response::json(&serde_json::json!({ "error": "Missing path" })),
    };

    let method = body.get("method").and_then(|v| v.as_str()).unwrap_or("GET").to_uppercase();
    let proxy_body = body.get("body");

    let url = format!("https://renzora.com/api/{}", path);

    let client = config::http_client();
    let cfg = config::load();

    let mut request = match method.as_str() {
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        _ => client.get(&url),
    };

    if let Some(token) = &cfg.auth_token {
        request = request.header("Authorization", format!("Bearer {}", token));
    }

    if let Some(body) = proxy_body {
        request = request.json(body);
    }

    match request.send() {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let ct = resp.headers().get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/json")
                .to_string();
            match resp.bytes() {
                Ok(bytes) => {
                    let body = if ct.contains("json") {
                        let json_str = String::from_utf8_lossy(&bytes);
                        let rewritten = json_str.replace("https://assets.renzora.com/", "/api/cdn?url=");
                        rewritten.into_bytes()
                    } else {
                        bytes.to_vec()
                    };
                    Response::bytes(body, ct).with_status(status)
                }
                Err(_) => Response::error(502, "Failed to read response"),
            }
        }
        Err(e) => Response::error(502, format!("Proxy failed: {}", e)),
    }
}

/// Proxy CDN assets from assets.renzora.com with range request support
/// Frontend calls: /api/cdn?url=path/to/asset.png
pub fn handle_cdn(req: Request) -> Response {
    let url_path = match req.query("url") {
        Some(p) => p.to_string(),
        None => return Response::error(400, "Missing url parameter"),
    };

    let url = format!("https://assets.renzora.com/{}", url_path);

    let client = reqwest::blocking::Client::builder()
        .user_agent("renzora-launcher/0.1.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new());

    let mut http_req = client.get(&url);

    // Forward Range header for audio/video seeking
    if let Some(range) = req.header("range") {
        http_req = http_req.header("Range", range);
    }

    match http_req.send() {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let ct = resp.headers().get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();

            let mut response_headers = vec![
                ("Accept-Ranges".to_string(), "bytes".to_string()),
            ];
            if let Some(cr) = resp.headers().get("content-range").and_then(|v| v.to_str().ok()) {
                response_headers.push(("Content-Range".to_string(), cr.to_string()));
            }
            if let Some(cl) = resp.headers().get("content-length").and_then(|v| v.to_str().ok()) {
                response_headers.push(("Content-Length".to_string(), cl.to_string()));
            }

            match resp.bytes() {
                Ok(bytes) => {
                    let mut r = Response::bytes(bytes.to_vec(), ct).with_status(status);
                    for (k, v) in response_headers {
                        r = r.with_header(k, v);
                    }
                    r
                }
                Err(_) => Response::error(502, "Failed to read CDN response"),
            }
        }
        Err(e) => Response::error(502, format!("CDN unavailable: {}", e)),
    }
}

/// Generic URL fetch proxy — frontend passes any URL, backend fetches it
/// GET /api/fetch?url=https://renzora.com/assets/wasm/renzora_preview.js
pub fn handle_fetch(req: Request) -> Response {
    let url = match req.query("url") {
        Some(u) => u.to_string(),
        None => return Response::error(400, "Missing url parameter"),
    };

    let client = reqwest::blocking::Client::builder()
        .user_agent("renzora-launcher/0.1.0")
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new());

    match client.get(&url).send() {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let ct = resp.headers().get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();
            match resp.bytes() {
                Ok(bytes) => Response::bytes(bytes.to_vec(), ct).with_status(status),
                Err(_) => Response::error(502, "Failed to read response"),
            }
        }
        Err(e) => Response::error(502, format!("Fetch failed: {}", e)),
    }
}

/// Serve renzora_preview.js from renzora.com
pub fn handle_wasm_js(_req: Request) -> Response {
    fetch_url("https://renzora.com/assets/wasm/renzora_preview.js")
}

/// Serve renzora_preview_bg.wasm from renzora.com
pub fn handle_wasm_bg(_req: Request) -> Response {
    fetch_url("https://renzora.com/assets/wasm/renzora_preview_bg.wasm")
}

fn fetch_url(url: &str) -> Response {
    let client = reqwest::blocking::Client::builder()
        .user_agent("renzora-launcher/0.1.0")
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new());

    match client.get(url).send() {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let ct = resp.headers().get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();
            match resp.bytes() {
                Ok(bytes) => Response::bytes(bytes.to_vec(), ct).with_status(status),
                Err(_) => Response::error(502, "Failed to read response"),
            }
        }
        Err(e) => Response::error(502, format!("Fetch failed: {}", e)),
    }
}

/// Proxy an embed preview page from renzora.com
pub fn handle_embed_preview(req: Request) -> Response {
    let path = match req.query("path") {
        Some(p) => p.to_string(),
        None => return Response::error(400, "Missing path parameter"),
    };

    let url = format!("https://renzora.com{}", path);

    let client = config::http_client();
    match client.get(&url).send() {
        Ok(resp) => {
            let status = resp.status().as_u16();
            match resp.bytes() {
                Ok(bytes) => {
                    let html = String::from_utf8_lossy(&bytes);
                    let rewritten = html.replace("https://assets.renzora.com/", "/api/cdn?url=");
                    Response::bytes(rewritten.into_bytes(), "text/html; charset=utf-8").with_status(status)
                }
                Err(_) => Response::error(502, "Failed to load page"),
            }
        }
        Err(e) => Response::error(502, format!("Failed to load page: {}", e)),
    }
}
