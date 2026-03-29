use webarcade::App;
use include_dir::{include_dir, Dir};

mod config;
mod routes;

// Embed frontend at compile time for release builds
#[cfg(not(debug_assertions))]
static DIST: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/dist");

fn main() {
    let app = App::new("Renzora Launcher", 1280, 720)
        .min_size(800, 600)
        // Engine
        .route("GET",  "/api/releases",      routes::engine::handle_releases)
        .route("GET",  "/api/installed",      routes::engine::handle_installed)
        .route("POST", "/api/install",        routes::engine::handle_install)
        .route("POST", "/api/uninstall",      routes::engine::handle_uninstall)
        .route("POST", "/api/launch",         routes::engine::handle_launch)
        .route("GET",  "/api/config",         routes::engine::handle_get_config)
        .route("POST", "/api/config",         routes::engine::handle_set_config)
        .route("POST", "/api/browse",         routes::engine::handle_browse)
        // Auth
        .route("POST", "/api/login",          routes::auth::handle_login)
        .route("POST", "/api/logout",         routes::auth::handle_logout)
        .route("POST", "/api/register",       routes::auth::handle_register)
        .route("GET",  "/api/user",           routes::auth::handle_user_info)
        // Marketplace
        .route("GET",  "/api/library",        routes::marketplace::handle_library)
        .route("GET",  "/api/games/library",  routes::marketplace::handle_game_library)
        .route("POST", "/api/purchase",       routes::marketplace::handle_purchase)
        .route("POST", "/api/download/start",  routes::download::handle_start)
        .route("GET",  "/api/download/progress", routes::download::handle_progress)
        .route("POST", "/api/download/check", routes::download::handle_check)
        .route("POST", "/api/download/clear", routes::download::handle_clear)
        .route("POST", "/api/check-owned",    routes::marketplace::handle_check_owned)
        .route("POST", "/api/comment",        routes::marketplace::handle_add_comment)
        .route("POST", "/api/review",         routes::marketplace::handle_submit_review)
        // Updater
        .route("GET",  "/api/updater/check",  routes::updater::handle_check_update)
        .route("POST", "/api/updater/update", routes::updater::handle_update)
        // Proxy
        .route("POST", "/api/proxy",          routes::proxy::handle_proxy)
        .route("GET",  "/api/cdn",            routes::proxy::handle_cdn)
        .route("GET",  "/api/fetch",          routes::proxy::handle_fetch)
        .route("GET",  "/api/embed",          routes::proxy::handle_embed_preview)
        // WASM preview files
        .route("GET",  "/wasm/renzora_preview.js",      routes::proxy::handle_wasm_js)
        .route("GET",  "/wasm/renzora_preview_bg.wasm", routes::proxy::handle_wasm_bg);

    // Release: embedded frontend (single binary). Dev: read from disk.
    #[cfg(not(debug_assertions))]
    let app = app.frontend_embed(&DIST);
    #[cfg(debug_assertions)]
    let app = app.frontend("dist");

    app.run();
}
