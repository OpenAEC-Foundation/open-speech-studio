use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub language: String,
    #[serde(default = "default_ui_language")]
    pub ui_language: String,
    pub model_name: String,
    pub model_path: String,
    pub use_gpu: bool,
    pub hotkey: String,
    #[serde(default = "default_hotkey_mode")]
    pub hotkey_mode: String,
    pub auto_paste: bool,
    pub audio_device: String,
    pub theme: String,
}

impl Default for Settings {
    fn default() -> Self {
        // Auto-detect bundled model
        let (model_name, model_path) = find_bundled_model();

        Self {
            language: "nl".to_string(),
            ui_language: "en".to_string(),
            model_name,
            model_path,
            use_gpu: false,
            hotkey: "Alt+Space".to_string(),
            hotkey_mode: "hold".to_string(),
            auto_paste: true,
            audio_device: "default".to_string(),
            theme: "light".to_string(),
        }
    }
}

fn default_ui_language() -> String {
    "en".to_string()
}

fn default_hotkey_mode() -> String {
    "hold".to_string()
}

/// Find the best available model, checking config dir (user downloads) first, then bundled dirs.
fn find_bundled_model() -> (String, String) {
    // Prefer small, fallback to base, then tiny
    let preferences = ["small", "base", "tiny", "medium", "large-v3-turbo", "large-v3"];

    for model_name in preferences {
        let filename = format!("ggml-{}.bin", model_name);
        if let Some(path) = find_model_file(&filename) {
            return (
                model_name.to_string(),
                path.to_string_lossy().to_string(),
            );
        }
    }

    ("base".to_string(), String::new())
}

/// Get all directories where models could be stored.
fn get_model_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    // 1. Next to the executable (installed app)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            dirs.push(exe_dir.join("models"));
            // Tauri bundles resources into _up_/ directory
            dirs.push(exe_dir.join("_up_/models"));
            // On some platforms, resources are in a sibling directory
            dirs.push(exe_dir.join("../models"));
            dirs.push(exe_dir.join("../Resources/models"));
        }
    }

    // 2. Project root models/ directory (development)
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd.join("models"));
        dirs.push(cwd.join("../models")); // When running from src-tauri/
    }

    // 3. User config directory
    if let Some(config) = dirs::config_dir() {
        dirs.push(config.join("open-speech-studio").join("models"));
    }

    dirs
}

pub fn get_config_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let dir = dirs::config_dir()
        .ok_or("Cannot find config directory")?
        .join("open-speech-studio");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Returns the stable directory for downloading/storing models.
/// Always uses the user config directory so Tauri rebuilds don't overwrite downloaded models.
pub fn get_models_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let dir = get_config_dir()?.join("models");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Search ALL known directories for a specific model file, returning the first real one found.
pub fn find_model_file(filename: &str) -> Option<PathBuf> {
    // Check config dir first (user downloads), then bundled/dev dirs
    let mut dirs = Vec::new();

    if let Some(config) = dirs::config_dir() {
        dirs.push(config.join("open-speech-studio").join("models"));
    }

    dirs.extend(get_model_search_dirs());

    for dir in &dirs {
        let path = dir.join(filename);
        if path.exists() && path.metadata().map(|m| m.len() > 1024).unwrap_or(false) {
            return Some(path);
        }
    }
    None
}

pub fn load_settings() -> Result<Settings, Box<dyn std::error::Error>> {
    let path = get_config_dir()?.join("settings.json");
    if !path.exists() {
        // First launch - create defaults with bundled model auto-detection
        let defaults = Settings::default();
        save_settings(&defaults)?;
        return Ok(defaults);
    }
    let content = std::fs::read_to_string(path)?;
    let mut settings: Settings = serde_json::from_str(&content)?;

    // If saved model_path doesn't exist or is a Git LFS pointer (<1 KB), try to find a bundled model
    let model_ok = if settings.model_path.is_empty() {
        false
    } else {
        let p = PathBuf::from(&settings.model_path);
        p.exists() && p.metadata().map(|m| m.len() > 1024).unwrap_or(false)
    };
    if !model_ok {
        let (name, path) = find_bundled_model();
        if !path.is_empty() {
            settings.model_name = name;
            settings.model_path = path;
        } else {
            // No valid model found — clear the stale path so frontend doesn't try to load it
            settings.model_path = String::new();
        }
    }

    Ok(settings)
}

pub fn save_settings(settings: &Settings) -> Result<(), Box<dyn std::error::Error>> {
    let path = get_config_dir()?.join("settings.json");
    let content = serde_json::to_string_pretty(settings)?;
    std::fs::write(path, content)?;
    Ok(())
}
