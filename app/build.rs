use std::env;
use std::fs;
use std::path::Path;

fn main() {
    // Rerun if plugins change
    println!("cargo:rerun-if-changed=plugins");

    // Generate embedded plugins module when locked-plugins feature is enabled
    if env::var("CARGO_FEATURE_LOCKED_PLUGINS").is_ok() {
        generate_embedded_plugins();
    }

    // Only run on Windows
    #[cfg(windows)]
    {
        let mut res = winres::WindowsResource::new();

        // App metadata (shown in Windows Explorer file properties)
        res.set("ProductName", env!("CARGO_PKG_NAME"));
        res.set("FileDescription", env!("CARGO_PKG_DESCRIPTION"));
        res.set("ProductVersion", env!("CARGO_PKG_VERSION"));
        res.set("FileVersion", env!("CARGO_PKG_VERSION"));

        // Icon (optional - only if icon.ico exists)
        if Path::new("icon.ico").exists() {
            res.set_icon("icon.ico");
        }

        res.compile().expect("Failed to compile Windows resources");
    }
}

/// Generate a Rust module that embeds all plugins from the plugins/ directory
fn generate_embedded_plugins() {
    let plugins_dir = Path::new("plugins");
    let out_dir = env::var("OUT_DIR").expect("OUT_DIR not set");
    let dest_path = Path::new(&out_dir).join("embedded_plugins.rs");

    let mut code = String::new();
    code.push_str("// Auto-generated: Embedded plugins\n\n");
    code.push_str("pub struct EmbeddedPlugin {\n");
    code.push_str("    pub id: &'static str,\n");
    code.push_str("    pub data: &'static [u8],\n");
    code.push_str("    pub is_dll: bool,\n");
    code.push_str("}\n\n");

    let mut plugins = Vec::new();

    if plugins_dir.exists() {
        if let Ok(entries) = fs::read_dir(plugins_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(ext) = path.extension() {
                        let ext_str = ext.to_string_lossy().to_lowercase();
                        let is_plugin = ext_str == "dll" || ext_str == "so" || ext_str == "dylib" || ext_str == "js";

                        if is_plugin {
                            let stem = path.file_stem().unwrap().to_string_lossy();
                            let plugin_id = stem.strip_prefix("lib").unwrap_or(&stem).to_string();
                            let is_dll = ext_str != "js";
                            let var_name = plugin_id.replace("-", "_").to_uppercase();

                            code.push_str(&format!(
                                "pub const {}_DATA: &[u8] = include_bytes!(r\"{}\");\n",
                                var_name,
                                path.canonicalize().unwrap().display()
                            ));

                            plugins.push((plugin_id, var_name, is_dll));
                        }
                    }
                }
            }
        }
    }

    // Generate the plugins array
    code.push_str("\npub const EMBEDDED_PLUGINS: &[EmbeddedPlugin] = &[\n");
    for (id, var_name, is_dll) in &plugins {
        code.push_str(&format!(
            "    EmbeddedPlugin {{ id: \"{}\", data: {}_DATA, is_dll: {} }},\n",
            id, var_name, is_dll
        ));
    }
    code.push_str("];\n");

    fs::write(&dest_path, code).expect("Failed to write embedded_plugins.rs");
    println!("cargo:rustc-cfg=has_embedded_plugins");
}
