use webarcade::{Request, Response};
use crate::config;

pub fn handle_library(_req: Request) -> Response {
    let cfg = config::load();
    let token = match &cfg.auth_token {
        Some(t) => t.clone(),
        None => return Response::json(&serde_json::json!({ "error": "Not logged in", "assets": [] })),
    };

    let client = config::http_client();
    match client.get("https://renzora.com/api/marketplace/purchased")
        .header("Authorization", format!("Bearer {}", token)).send()
    {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().unwrap_or(serde_json::json!({ "assets": [] }));
            Response::json(&data)
        }
        _ => Response::json(&serde_json::json!({ "error": "Failed to fetch library", "assets": [] })),
    }
}

pub fn handle_game_library(_req: Request) -> Response {
    let cfg = config::load();
    let token = match &cfg.auth_token {
        Some(t) => t.clone(),
        None => return Response::json(&serde_json::json!({ "error": "Not logged in", "games": [] })),
    };

    let client = config::http_client();
    match client.get("https://renzora.com/api/games/library")
        .header("Authorization", format!("Bearer {}", token)).send()
    {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().unwrap_or(serde_json::json!({ "games": [] }));
            Response::json(&data)
        }
        _ => Response::json(&serde_json::json!({ "error": "Failed to fetch game library", "games": [] })),
    }
}

pub fn handle_purchase(req: Request) -> Response {
    let body: serde_json::Value = match req.json() {
        Ok(v) => v,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("Invalid request: {}", e) })),
    };

    let asset_id = match body.get("asset_id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return Response::json(&serde_json::json!({ "error": "Missing asset_id" })),
    };

    let promo_code = body.get("promo_code").and_then(|v| v.as_str()).map(|s| s.to_string());

    let cfg = config::load();
    let token = match &cfg.auth_token {
        Some(t) => t.clone(),
        None => return Response::json(&serde_json::json!({ "error": "Not logged in" })),
    };

    let client = config::http_client();
    let mut purchase_body = serde_json::json!({ "asset_id": asset_id });
    if let Some(code) = promo_code {
        purchase_body["promo_code"] = serde_json::json!(code);
    }

    let resp = match client.post("https://renzora.com/api/credits/purchase")
        .header("Authorization", format!("Bearer {}", token))
        .json(&purchase_body).send()
    {
        Ok(r) => r,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("Purchase failed: {}", e) })),
    };

    let status = resp.status();
    let data: serde_json::Value = resp.json().unwrap_or(serde_json::json!({}));

    if !status.is_success() {
        let msg = data.get("error").and_then(|e| e.as_str()).unwrap_or("Purchase failed");
        return Response::json(&serde_json::json!({ "error": msg }));
    }

    if let Some(new_balance) = data.get("new_balance").and_then(|v| v.as_i64()) {
        let mut cfg = config::load();
        cfg.credit_balance = Some(new_balance);
        config::save(&cfg);
    }

    Response::json(&data)
}

pub fn handle_check_owned(req: Request) -> Response {
    let body: serde_json::Value = match req.json() {
        Ok(v) => v,
        Err(_) => return Response::json(&serde_json::json!({ "owned_ids": [] })),
    };

    let cfg = config::load();
    let token = match &cfg.auth_token {
        Some(t) => t.clone(),
        None => return Response::json(&serde_json::json!({ "owned_ids": [] })),
    };

    let client = config::http_client();
    match client.post("https://renzora.com/api/user/owned")
        .header("Authorization", format!("Bearer {}", token))
        .json(&body).send()
    {
        Ok(resp) => {
            let data: serde_json::Value = resp.json().unwrap_or(serde_json::json!({ "owned_ids": [] }));
            Response::json(&data)
        }
        Err(_) => Response::json(&serde_json::json!({ "owned_ids": [] })),
    }
}

pub fn handle_add_comment(req: Request) -> Response {
    let body: serde_json::Value = match req.json() {
        Ok(v) => v,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("Invalid request: {}", e) })),
    };

    let asset_id = match body.get("asset_id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return Response::json(&serde_json::json!({ "error": "Missing asset_id" })),
    };
    let content = match body.get("content").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None => return Response::json(&serde_json::json!({ "error": "Missing content" })),
    };

    let cfg = config::load();
    let token = match &cfg.auth_token {
        Some(t) => t.clone(),
        None => return Response::json(&serde_json::json!({ "error": "Not logged in" })),
    };

    let client = config::http_client();
    let url = format!("https://renzora.com/api/marketplace/{}/comments", asset_id);
    match client.post(&url).header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({ "content": content })).send()
    {
        Ok(resp) => {
            let data: serde_json::Value = resp.json().unwrap_or(serde_json::json!({ "error": "Invalid response" }));
            Response::json(&data)
        }
        Err(e) => Response::json(&serde_json::json!({ "error": format!("Failed to post comment: {}", e) })),
    }
}

pub fn handle_submit_review(req: Request) -> Response {
    let body: serde_json::Value = match req.json() {
        Ok(v) => v,
        Err(e) => return Response::json(&serde_json::json!({ "error": format!("Invalid request: {}", e) })),
    };

    let asset_id = match body.get("asset_id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return Response::json(&serde_json::json!({ "error": "Missing asset_id" })),
    };
    let rating = match body.get("rating").and_then(|v| v.as_i64()) {
        Some(r) => r,
        None => return Response::json(&serde_json::json!({ "error": "Missing rating" })),
    };
    let title = body.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let content = body.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let cfg = config::load();
    let token = match &cfg.auth_token {
        Some(t) => t.clone(),
        None => return Response::json(&serde_json::json!({ "error": "Not logged in" })),
    };

    let client = config::http_client();
    let url = format!("https://renzora.com/api/marketplace/{}/reviews", asset_id);
    match client.post(&url).header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({ "rating": rating, "title": title, "content": content })).send()
    {
        Ok(resp) => {
            let status = resp.status();
            let data: serde_json::Value = resp.json().unwrap_or(serde_json::json!({}));
            if !status.is_success() {
                let msg = data.get("error").and_then(|e| e.as_str()).unwrap_or("Review failed");
                return Response::json(&serde_json::json!({ "error": msg }));
            }
            Response::json(&data)
        }
        Err(e) => Response::json(&serde_json::json!({ "error": format!("Failed to submit review: {}", e) })),
    }
}
