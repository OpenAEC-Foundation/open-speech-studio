mod audio;
mod dictionary;
mod settings;
mod transcriber;

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

pub struct AppState {
    transcriber: Arc<Mutex<Option<transcriber::Transcriber>>>,
    recorder: Arc<Mutex<Option<audio::AudioRecorder>>>,
    settings: Arc<Mutex<settings::Settings>>,
    dictionary: Arc<Mutex<dictionary::Dictionary>>,
    is_recording: Arc<Mutex<bool>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptionResult {
    pub text: String,
    pub language: String,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelInfo {
    pub name: String,
    pub size: String,
    pub downloaded: bool,
    pub path: Option<String>,
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<settings::Settings, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(settings.clone())
}

#[tauri::command]
async fn save_settings(
    state: State<'_, AppState>,
    new_settings: settings::Settings,
) -> Result<(), String> {
    let mut settings = state.settings.lock().map_err(|e| e.to_string())?;
    *settings = new_settings.clone();
    settings::save_settings(&new_settings).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_available_models() -> Result<Vec<ModelInfo>, String> {
    let models_dir = settings::get_models_dir().map_err(|e| e.to_string())?;
    let models = vec![
        ("tiny", "75 MB"),
        ("base", "142 MB"),
        ("small", "466 MB"),
        ("medium", "1.5 GB"),
        ("large-v3", "3.1 GB"),
        ("large-v3-turbo", "1.6 GB"),
    ];

    Ok(models
        .into_iter()
        .map(|(name, size)| {
            let path = models_dir.join(format!("ggml-{}.bin", name));
            ModelInfo {
                name: name.to_string(),
                size: size.to_string(),
                downloaded: path.exists(),
                path: if path.exists() {
                    Some(path.to_string_lossy().to_string())
                } else {
                    None
                },
            }
        })
        .collect())
}

#[tauri::command]
async fn download_model(
    app: tauri::AppHandle,
    model_name: String,
) -> Result<String, String> {
    let models_dir = settings::get_models_dir().map_err(|e| e.to_string())?;
    let dest = models_dir.join(format!("ggml-{}.bin", model_name));

    if dest.exists() {
        return Ok(dest.to_string_lossy().to_string());
    }

    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
        model_name
    );

    // Emit download start event
    let _ = app.emit("model-download-start", &model_name);

    // Download using a simple HTTP client approach via shell
    let output = std::process::Command::new("curl")
        .args(["-L", "-o", &dest.to_string_lossy(), "--progress-bar", &url])
        .output()
        .map_err(|e| format!("Failed to download model: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Download failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let _ = app.emit("model-download-complete", &model_name);

    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
async fn load_model(state: State<'_, AppState>, model_path: String) -> Result<(), String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
    let use_gpu = settings.use_gpu;

    let new_transcriber =
        transcriber::Transcriber::new(&model_path, use_gpu).map_err(|e| e.to_string())?;

    let mut transcriber = state.transcriber.lock().map_err(|e| e.to_string())?;
    *transcriber = Some(new_transcriber);

    Ok(())
}

#[tauri::command]
async fn start_recording(state: State<'_, AppState>) -> Result<(), String> {
    let mut is_recording = state.is_recording.lock().map_err(|e| e.to_string())?;
    if *is_recording {
        return Ok(());
    }

    let recorder = audio::AudioRecorder::new().map_err(|e| e.to_string())?;
    recorder.start().map_err(|e| e.to_string())?;

    let mut rec = state.recorder.lock().map_err(|e| e.to_string())?;
    *rec = Some(recorder);
    *is_recording = true;

    Ok(())
}

#[tauri::command]
async fn stop_recording(state: State<'_, AppState>) -> Result<TranscriptionResult, String> {
    let mut is_recording = state.is_recording.lock().map_err(|e| e.to_string())?;
    if !*is_recording {
        return Err("Not recording".to_string());
    }

    // Stop recording and get audio data
    let audio_data = {
        let mut rec = state.recorder.lock().map_err(|e| e.to_string())?;
        let recorder = rec.take().ok_or("No recorder")?;
        recorder.stop().map_err(|e| e.to_string())?
    };

    *is_recording = false;

    // Transcribe
    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
    let transcriber_guard = state.transcriber.lock().map_err(|e| e.to_string())?;
    let transcriber = transcriber_guard.as_ref().ok_or("Model not loaded")?;

    let start = std::time::Instant::now();
    let mut text = transcriber
        .transcribe(&audio_data, &settings.language)
        .map_err(|e| e.to_string())?;
    let duration_ms = start.elapsed().as_millis() as u64;

    // Apply dictionary corrections
    let dict = state.dictionary.lock().map_err(|e| e.to_string())?;
    text = dict.apply_corrections(&text);

    Ok(TranscriptionResult {
        text,
        language: settings.language.clone(),
        duration_ms,
    })
}

#[tauri::command]
async fn get_recording_status(state: State<'_, AppState>) -> Result<bool, String> {
    let is_recording = state.is_recording.lock().map_err(|e| e.to_string())?;
    Ok(*is_recording)
}

#[tauri::command]
async fn is_model_loaded(state: State<'_, AppState>) -> Result<bool, String> {
    let transcriber = state.transcriber.lock().map_err(|e| e.to_string())?;
    Ok(transcriber.is_some())
}

#[tauri::command]
async fn get_dictionary(state: State<'_, AppState>) -> Result<dictionary::Dictionary, String> {
    let dict = state.dictionary.lock().map_err(|e| e.to_string())?;
    Ok(dict.clone())
}

#[tauri::command]
async fn save_dictionary(
    state: State<'_, AppState>,
    dict: dictionary::Dictionary,
) -> Result<(), String> {
    let mut current = state.dictionary.lock().map_err(|e| e.to_string())?;
    *current = dict.clone();
    dictionary::save_dictionary(&dict).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn add_dictionary_word(
    state: State<'_, AppState>,
    word: String,
    replacement: Option<String>,
) -> Result<(), String> {
    let mut dict = state.dictionary.lock().map_err(|e| e.to_string())?;
    dict.add_word(word, replacement);
    dictionary::save_dictionary(&dict).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn remove_dictionary_word(
    state: State<'_, AppState>,
    word: String,
) -> Result<(), String> {
    let mut dict = state.dictionary.lock().map_err(|e| e.to_string())?;
    dict.remove_word(&word);
    dictionary::save_dictionary(&dict).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_audio_devices() -> Result<Vec<String>, String> {
    audio::list_input_devices().map_err(|e| e.to_string())
}

#[tauri::command]
async fn type_text(text: String) -> Result<(), String> {
    use enigo::{Enigo, KeyboardControllable};
    let mut enigo = Enigo::new();
    enigo.key_sequence(&text);
    Ok(())
}

pub fn run() {
    env_logger::init();

    let settings = settings::load_settings().unwrap_or_default();
    let dictionary = dictionary::load_dictionary().unwrap_or_default();

    // Auto-load the bundled model at startup so the user can dictate immediately
    let initial_transcriber = if !settings.model_path.is_empty()
        && std::path::Path::new(&settings.model_path).exists()
    {
        log::info!("Auto-loading model: {}", settings.model_path);
        match transcriber::Transcriber::new(&settings.model_path, settings.use_gpu) {
            Ok(t) => {
                log::info!("Model loaded successfully");
                Some(t)
            }
            Err(e) => {
                log::warn!("Failed to auto-load model: {}", e);
                None
            }
        }
    } else {
        log::info!("No bundled model found, user must download one");
        None
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            transcriber: Arc::new(Mutex::new(initial_transcriber)),
            recorder: Arc::new(Mutex::new(None)),
            settings: Arc::new(Mutex::new(settings)),
            dictionary: Arc::new(Mutex::new(dictionary)),
            is_recording: Arc::new(Mutex::new(false)),
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_available_models,
            download_model,
            load_model,
            start_recording,
            stop_recording,
            get_recording_status,
            get_dictionary,
            save_dictionary,
            add_dictionary_word,
            remove_dictionary_word,
            get_audio_devices,
            is_model_loaded,
            type_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open Speech Studio");
}
