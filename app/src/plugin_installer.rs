use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::ZipArchive;

#[derive(Debug, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub has_frontend: Option<bool>,
    pub has_backend: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct InstallResult {
    pub success: bool,
    pub plugin_name: String,
    pub plugin_id: String,
    pub message: String,
}

pub struct PluginInstaller {
    plugins_dir: PathBuf,
}

impl PluginInstaller {
    pub fn new(plugins_dir: PathBuf) -> Self {
        Self { plugins_dir }
    }

    /// Install a plugin from zip data
    pub fn install_from_zip(&self, zip_data: &[u8], file_name: &str) -> Result<InstallResult> {
        log::info!("Installing plugin from: {}", file_name);

        // Create a cursor from the zip data
        let cursor = std::io::Cursor::new(zip_data);
        let mut archive = ZipArchive::new(cursor)
            .map_err(|e| anyhow!("Failed to read zip file: {}", e))?;

        // Validate the plugin structure and extract manifest
        let manifest = self.validate_plugin_structure(&mut archive)?;

        log::info!(
            "Installing plugin: {} ({})",
            manifest.name,
            manifest.id
        );

        // Check if plugin already exists
        let plugin_install_dir = self.plugins_dir.join(&manifest.id);
        if plugin_install_dir.exists() {
            log::warn!("Plugin {} already exists, removing old version", manifest.id);
            fs::remove_dir_all(&plugin_install_dir)
                .map_err(|e| anyhow!("Failed to remove existing plugin: {}", e))?;
        }

        // Extract the plugin
        self.extract_plugin(&mut archive, &plugin_install_dir)?;

        log::info!("Plugin {} installed successfully", manifest.id);

        Ok(InstallResult {
            success: true,
            plugin_name: manifest.name.clone(),
            plugin_id: manifest.id.clone(),
            message: format!("Plugin '{}' installed successfully", manifest.name),
        })
    }

    /// Validate that the zip contains a valid plugin structure
    fn validate_plugin_structure(&self, archive: &mut ZipArchive<std::io::Cursor<&[u8]>>) -> Result<PluginManifest> {
        // Look for manifest.json in the root or first-level directory
        let mut manifest_content = None;

        // First pass: find manifest.json
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
                .map_err(|e| anyhow!("Failed to read zip entry: {}", e))?;
            let file_path = file.name().to_string();

            // Check if this is manifest.json
            if file_path.ends_with("manifest.json") {
                let mut content = String::new();
                file.read_to_string(&mut content)
                    .map_err(|e| anyhow!("Failed to read manifest.json: {}", e))?;
                manifest_content = Some(content);
                break;
            }
        }

        let manifest_json = manifest_content
            .ok_or_else(|| anyhow!("No manifest.json found in plugin zip"))?;

        let manifest: PluginManifest = serde_json::from_str(&manifest_json)
            .map_err(|e| anyhow!("Invalid manifest.json: {}", e))?;

        // Validate required fields
        if manifest.id.is_empty() {
            return Err(anyhow!("Plugin manifest missing required field: id"));
        }
        if manifest.name.is_empty() {
            return Err(anyhow!("Plugin manifest missing required field: name"));
        }
        if manifest.version.is_empty() {
            return Err(anyhow!("Plugin manifest missing required field: version"));
        }

        // Validate plugin ID (must be valid directory name)
        if !manifest.id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
            return Err(anyhow!(
                "Invalid plugin ID '{}': must contain only alphanumeric characters, hyphens, and underscores",
                manifest.id
            ));
        }

        log::info!("Plugin validation passed: {}", manifest.name);
        Ok(manifest)
    }

    /// Extract the plugin to the plugins directory
    fn extract_plugin(
        &self,
        archive: &mut ZipArchive<std::io::Cursor<&[u8]>>,
        plugin_dir: &Path,
    ) -> Result<()> {
        // Determine if files are in a subdirectory
        let root_prefix = if archive.len() > 0 {
            // Get the first file path in a separate scope
            let first_path = {
                let first_file = archive.by_index(0)
                    .map_err(|e| anyhow!("Failed to read first zip entry: {}", e))?;
                first_file.name().to_string()
            }; // first_file is dropped here

            // Check if all files share a common root directory
            if first_path.contains('/') {
                let potential_prefix = first_path.split('/').next().unwrap_or("");

                // Verify all files start with this prefix
                let mut all_match = true;
                for i in 0..archive.len() {
                    let file_name = {
                        let file = archive.by_index(i)
                            .map_err(|e| anyhow!("Failed to read zip entry: {}", e))?;
                        file.name().to_string()
                    }; // file is dropped here

                    if !file_name.starts_with(&format!("{}/", potential_prefix)) && file_name != potential_prefix {
                        all_match = false;
                        break;
                    }
                }

                if all_match {
                    format!("{}/", potential_prefix)
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        // Create plugin directory
        fs::create_dir_all(plugin_dir)
            .map_err(|e| anyhow!("Failed to create plugin directory: {}", e))?;

        // Extract files
        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
                .map_err(|e| anyhow!("Failed to read zip entry: {}", e))?;

            let file_path = file.name().to_string();

            // Skip the root directory itself
            if !root_prefix.is_empty() && file_path == root_prefix.trim_end_matches('/') {
                continue;
            }

            // Remove root prefix if present
            let relative_path = if !root_prefix.is_empty() && file_path.starts_with(&root_prefix) {
                file_path.strip_prefix(&root_prefix).unwrap()
            } else {
                &file_path
            };

            // Skip empty paths
            if relative_path.is_empty() {
                continue;
            }

            let output_path = plugin_dir.join(relative_path);

            if file.is_dir() {
                // Create directory
                fs::create_dir_all(&output_path)
                    .map_err(|e| anyhow!("Failed to create directory {:?}: {}", output_path, e))?;
            } else {
                // Create parent directories
                if let Some(parent) = output_path.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| anyhow!("Failed to create parent directory: {}", e))?;
                }

                // Extract file
                let mut outfile = fs::File::create(&output_path)
                    .map_err(|e| anyhow!("Failed to create file {:?}: {}", output_path, e))?;

                let mut buffer = Vec::new();
                file.read_to_end(&mut buffer)
                    .map_err(|e| anyhow!("Failed to read file from zip: {}", e))?;

                outfile.write_all(&buffer)
                    .map_err(|e| anyhow!("Failed to write file: {}", e))?;

                log::debug!("Extracted: {:?}", output_path);
            }
        }

        log::info!("Plugin extracted to: {:?}", plugin_dir);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plugin_installer_creation() {
        let temp_dir = std::env::temp_dir().join("webarcade_test_installer");
        let installer = PluginInstaller::new(temp_dir);
        // Just test that we can create an installer
    }
}
