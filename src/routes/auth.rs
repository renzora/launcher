use webarcade::{Request, Response};
use crate::config;

pub fn handle_login(req: Request) -> Response {
    let body: serde_json::Value = match req.json() {
        Ok(v) => v,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("Invalid request: {}", e) })),
    };

    let email = match body.get("email").and_then(|v| v.as_str()) {
        Some(e) => e.to_string(),
        None => return Response::json(&serde_json::json!({ "error": "Missing email" })),
    };
    let password = match body.get("password").and_then(|v| v.as_str()) {
        Some(p) => p.to_string(),
        None => return Response::json(&serde_json::json!({ "error": "Missing password" })),
    };

    let client = config::http_client();
    let resp = match client
        .post("https://renzora.com/api/auth/login")
        .json(&serde_json::json!({ "email": email, "password": password }))
        .send()
    {
        Ok(r) => r,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("Login failed: {}", e) })),
    };

    if !resp.status().is_success() {
        let err: serde_json::Value = resp.json().unwrap_or(serde_json::json!({}));
        let msg = err.get("error").and_then(|e| e.as_str()).unwrap_or("Invalid credentials");
        return Response::json(&serde_json::json!({ "error": msg }));
    }

    let data: serde_json::Value = match resp.json() {
        Ok(v) => v,
        Err(_) => return Response::json(&serde_json::json!({ "error": "Invalid response from server" })),
    };

    let token = data.get("access_token").and_then(|t| t.as_str());
    let user = data.get("user");
    let username = user.and_then(|u| u.get("username")).and_then(|n| n.as_str());
    let balance = user.and_then(|u| u.get("credit_balance")).and_then(|c| c.as_i64());

    if let Some(token) = token {
        let mut cfg = config::load();
        cfg.auth_token = Some(token.to_string());
        cfg.username = username.map(|s| s.to_string());
        cfg.credit_balance = balance;
        config::save(&cfg);
    } else {
        return Response::json(&serde_json::json!({ "error": "No access token in response" }));
    }

    Response::json(&serde_json::json!({ "status": "ok", "username": username, "credit_balance": balance }))
}

pub fn handle_logout(_req: Request) -> Response {
    let mut cfg = config::load();
    cfg.auth_token = None;
    cfg.username = None;
    cfg.credit_balance = None;
    config::save(&cfg);
    Response::json(&serde_json::json!({ "status": "ok" }))
}

pub fn handle_register(req: Request) -> Response {
    let body: serde_json::Value = match req.json() {
        Ok(v) => v,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("Invalid request: {}", e) })),
    };

    let username = match body.get("username").and_then(|v| v.as_str()) {
        Some(u) => u.to_string(),
        None => return Response::json(&serde_json::json!({ "error": "Missing username" })),
    };
    let email = match body.get("email").and_then(|v| v.as_str()) {
        Some(e) => e.to_string(),
        None => return Response::json(&serde_json::json!({ "error": "Missing email" })),
    };
    let password = match body.get("password").and_then(|v| v.as_str()) {
        Some(p) => p.to_string(),
        None => return Response::json(&serde_json::json!({ "error": "Missing password" })),
    };

    let client = config::http_client();
    let resp = match client
        .post("https://renzora.com/api/auth/register")
        .json(&serde_json::json!({ "username": username, "email": email, "password": password }))
        .send()
    {
        Ok(r) => r,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("Registration failed: {}", e) })),
    };

    if !resp.status().is_success() {
        let err: serde_json::Value = resp.json().unwrap_or(serde_json::json!({}));
        let msg = err.get("error").and_then(|e| e.as_str()).unwrap_or("Registration failed");
        return Response::json(&serde_json::json!({ "error": msg }));
    }

    let data: serde_json::Value = match resp.json() {
        Ok(v) => v,
        Err(_) => return Response::json(&serde_json::json!({ "error": "Invalid response" })),
    };

    let token = data.get("access_token").and_then(|t| t.as_str());
    let user = data.get("user");
    let username = user.and_then(|u| u.get("username")).and_then(|n| n.as_str());
    let balance = user.and_then(|u| u.get("credit_balance")).and_then(|c| c.as_i64());

    if let Some(token) = token {
        let mut cfg = config::load();
        cfg.auth_token = Some(token.to_string());
        cfg.username = username.map(|s| s.to_string());
        cfg.credit_balance = balance;
        config::save(&cfg);
    } else {
        return Response::json(&serde_json::json!({ "error": "No access token in response" }));
    }

    Response::json(&serde_json::json!({ "status": "ok", "username": username, "credit_balance": balance }))
}

pub fn handle_user_info(_req: Request) -> Response {
    let cfg = config::load();
    let token = match &cfg.auth_token {
        Some(t) => t.clone(),
        None => return Response::json(&serde_json::json!({ "error": "Not logged in" })),
    };

    let client = config::http_client();
    match client.get("https://renzora.com/api/user/me").header("Authorization", format!("Bearer {}", token)).send() {
        Ok(resp) => {
            if !resp.status().is_success() {
                return Response::json(&serde_json::json!({ "error": "Failed to fetch user info" }));
            }
            let data: serde_json::Value = resp.json().unwrap_or(serde_json::json!({}));
            if let Some(balance) = data.get("credit_balance").and_then(|v| v.as_i64()) {
                let mut cfg = config::load();
                cfg.credit_balance = Some(balance);
                config::save(&cfg);
            }
            Response::json(&data)
        }
        Err(e) => Response::json(&serde_json::json!({ "error": format!("Request failed: {}", e) })),
    }
}
