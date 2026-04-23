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
    #[serde(default = "default_false")]
    pub file_auto_save: bool,
    #[serde(default)]
    pub file_save_directory: String,
    #[serde(default = "default_true")]
    pub file_confirm_actions: bool,
    #[serde(default = "default_true")]
    pub audio_feedback: bool,

    // Transcription
    #[serde(default = "default_incremental_interval_secs")]
    pub incremental_interval_secs: f32,
    #[serde(default = "default_max_workers")]
    pub max_workers: usize,
    #[serde(default)]
    pub auto_correct: bool,
    #[serde(default)]
    pub auto_correct_model: String,

    // Meeting
    #[serde(default = "default_meeting_save_dir")]
    pub meeting_save_dir: String,
    #[serde(default)]
    pub speaker_diarization: bool,
    #[serde(default = "default_true")]
    pub floating_indicator: bool,

    // Sounds
    #[serde(default = "default_sound_pack")]
    pub sound_pack: String,
    #[serde(default = "default_sound_volume")]
    pub sound_volume: f32,

    // Remote transcription server. URL + bearer token are resolved at call
    // time from the OIDC session (see crate::app_config); only the on/off
    // toggle is a user choice.
    #[serde(default)]
    pub remote_server_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        // Auto-detect bundled model
        let (model_name, model_path) = find_bundled_model();

        Self {
            language: "auto".to_string(),
            ui_language: "en".to_string(),
            model_name,
            model_path,
            use_gpu: true,
            hotkey: "Ctrl+Super".to_string(),
            hotkey_mode: "hold".to_string(),
            auto_paste: true,
            audio_device: "default".to_string(),
            theme: "light".to_string(),
            file_auto_save: false,
            file_save_directory: String::new(),
            file_confirm_actions: true,
            audio_feedback: true,
            incremental_interval_secs: 2.0,
            max_workers: 2,
            auto_correct: false,
            auto_correct_model: String::new(),
            meeting_save_dir: dirs::document_dir()
                .unwrap_or_default()
                .join("OSS Meetings")
                .to_string_lossy()
                .to_string(),
            speaker_diarization: false,
            floating_indicator: true,
            sound_pack: "retro".to_string(),
            sound_volume: 0.7,
            remote_server_enabled: false,
        }
    }
}

fn default_ui_language() -> String {
    "en".to_string()
}

fn default_hotkey_mode() -> String {
    "hold".to_string()
}

fn default_false() -> bool {
    false
}

fn default_true() -> bool {
    true
}

fn default_incremental_interval_secs() -> f32 {
    2.0
}

fn default_max_workers() -> usize {
    2
}

fn default_meeting_save_dir() -> String {
    dirs::document_dir()
        .unwrap_or_default()
        .join("OSS Meetings")
        .to_string_lossy()
        .to_string()
}

fn default_sound_pack() -> String {
    "retro".to_string()
}

fn default_sound_volume() -> f32 {
    0.7
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
