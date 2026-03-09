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
        Self {
            language: "auto".to_string(),
            model_name: "base".to_string(),
            model_path: String::new(),
            use_gpu: false,
            hotkey: "CmdOrCtrl+Shift+Space".to_string(),
            auto_paste: true,
            audio_device: "default".to_string(),
            theme: "light".to_string(),
        }
    }
}

pub fn get_config_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let dir = dirs::config_dir()
        .ok_or("Cannot find config directory")?
        .join("open-speech-studio");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn get_models_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let dir = get_config_dir()?.join("models");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn load_settings() -> Result<Settings, Box<dyn std::error::Error>> {
    let path = get_config_dir()?.join("settings.json");
    if !path.exists() {
        return Ok(Settings::default());
    }
    let content = std::fs::read_to_string(path)?;
    let settings: Settings = serde_json::from_str(&content)?;
    Ok(settings)
}

pub fn save_settings(settings: &Settings) -> Result<(), Box<dyn std::error::Error>> {
    let path = get_config_dir()?.join("settings.json");
    let content = serde_json::to_string_pretty(settings)?;
    std::fs::write(path, content)?;
    Ok(())
}
