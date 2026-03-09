use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub language: String,
    pub model_name: String,
    pub model_path: String,
    pub use_gpu: bool,
    pub hotkey: String,
    pub auto_paste: bool,
    pub audio_device: String,
    pub theme: String,
}

impl Default for Settings {
    fn default() -> Self {
        // Auto-detect bundled model
        let (model_name, model_path) = find_bundled_model();

        Self {
            language: "auto".to_string(),
            model_name,
            model_path,
            use_gpu: false,
            hotkey: "CmdOrCtrl+Shift+Space".to_string(),
            auto_paste: true,
            audio_device: "default".to_string(),
            theme: "light".to_string(),
        }
    }
}

/// Find a bundled model in the models/ directory next to the executable or in the project root.
fn find_bundled_model() -> (String, String) {
    let search_dirs = get_model_search_dirs();

    // Prefer base, fallback to tiny
    let preferences = ["base", "tiny", "small", "medium", "large-v3-turbo", "large-v3"];

    for model_name in preferences {
        let filename = format!("ggml-{}.bin", model_name);
        for dir in &search_dirs {
            let path = dir.join(&filename);
            if path.exists() {
                return (
                    model_name.to_string(),
                    path.to_string_lossy().to_string(),
                );
            }
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

pub fn get_models_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    // First check for bundled models directory
    let search_dirs = get_model_search_dirs();
    for dir in &search_dirs {
        if dir.exists() {
            return Ok(dir.clone());
        }
    }

    // Fallback to config directory
    let dir = get_config_dir()?.join("models");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
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

    // If saved model_path doesn't exist, try to find a bundled model
    if settings.model_path.is_empty() || !PathBuf::from(&settings.model_path).exists() {
        let (name, path) = find_bundled_model();
        if !path.is_empty() {
            settings.model_name = name;
            settings.model_path = path;
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
