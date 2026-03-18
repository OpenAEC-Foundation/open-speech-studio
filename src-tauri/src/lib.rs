mod audio;
mod dictionary;
mod settings;
mod transcriber;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{
    Emitter, Manager, State,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};

pub struct AppState {
    transcriber: Arc<Mutex<Option<transcriber::Transcriber>>>,
    recorder: Arc<Mutex<Option<audio::AudioRecorder>>>,
    settings: Arc<Mutex<settings::Settings>>,
    dictionary: Arc<Mutex<dictionary::Dictionary>>,
    is_recording: Arc<Mutex<bool>>,
    /// Active file transcription jobs: job_id -> child PID (for cancellation)
    file_jobs: Arc<Mutex<HashMap<String, u32>>>,
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
            let filename = format!("ggml-{}.bin", name);
            // Search ALL known directories for this model (config dir, bundled, dev)
            let found = settings::find_model_file(&filename);
            ModelInfo {
                name: name.to_string(),
                size: size.to_string(),
                downloaded: found.is_some(),
                path: found.map(|p| p.to_string_lossy().to_string()),
            }
        })
        .collect())
}

#[tauri::command]
async fn download_model(
    app: tauri::AppHandle,
    model_name: String,
) -> Result<String, String> {
    let filename = format!("ggml-{}.bin", model_name);

    // Skip download if a real model already exists anywhere (config dir, bundled, etc.)
    if let Some(existing) = settings::find_model_file(&filename) {
        return Ok(existing.to_string_lossy().to_string());
    }

    // Download to the stable config directory (not _up_/ which Tauri rebuilds overwrite)
    let models_dir = settings::get_models_dir().map_err(|e| e.to_string())?;
    let dest = models_dir.join(&filename);

    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
        model_name
    );

    // Emit download start event
    let _ = app.emit("model-download-start", &model_name);

    // Download using curl (hidden window on Windows)
    let mut cmd = std::process::Command::new("curl");
    cmd.args(["-L", "-o", &dest.to_string_lossy(), "--progress-bar", &url]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd
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
async fn delete_model(state: State<'_, AppState>, model_name: String) -> Result<(), String> {
    let filename = format!("ggml-{}.bin", model_name);

    // Find the model file
    let path = settings::find_model_file(&filename)
        .ok_or_else(|| format!("Model '{}' not found", model_name))?;

    // If this model is currently active, unload it
    {
        let settings = state.settings.lock().map_err(|e| e.to_string())?;
        if settings.model_name == model_name {
            let mut transcriber = state.transcriber.lock().map_err(|e| e.to_string())?;
            *transcriber = None;
        }
    }

    // Delete the file
    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete model: {}", e))?;

    Ok(())
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

    let mut recorder = audio::AudioRecorder::new().map_err(|e| e.to_string())?;
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileJobProgress {
    pub job_id: String,
    pub progress: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileJobResult {
    pub job_id: String,
    pub text: String,
    pub language: String,
    pub duration_ms: u64,
    pub error: Option<String>,
}

/// Start a file transcription as a background job. Returns immediately.
/// Emits `file-job-progress` and `file-job-done` events.
#[tauri::command]
async fn start_file_job(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    job_id: String,
    file_path: String,
) -> Result<(), String> {
    use std::process::{Command, Stdio};
    use std::io::{BufRead, BufReader};

    // Gather what we need without holding locks long
    let (whisper_bin, model_path, language, dict) = {
        let settings = state.settings.lock().map_err(|e| e.to_string())?;
        let transcriber_guard = state.transcriber.lock().map_err(|e| e.to_string())?;
        let t = transcriber_guard
            .as_ref()
            .ok_or("Model not loaded. Go to Models to load one.")?;
        let d = state.dictionary.lock().map_err(|e| e.to_string())?.clone();
        (
            t.whisper_bin.clone(),
            t.model_path.clone(),
            settings.language.clone(),
            d,
        )
    };

    let mut cmd = Command::new(&whisper_bin);
    cmd.arg("-m").arg(&model_path);
    cmd.arg("-f").arg(&file_path);
    cmd.arg("--no-timestamps");
    cmd.arg("-t").arg("4");
    // No --output-txt: we read from stdout, don't create files next to the input
    cmd.stderr(Stdio::piped());
    cmd.stdout(Stdio::piped());

    if !language.is_empty() && language != "auto" {
        cmd.arg("-l").arg(&language);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to start whisper: {}", e))?;

    // Store PID for cancellation
    let pid = child.id();
    {
        let mut jobs = state.file_jobs.lock().map_err(|e| e.to_string())?;
        jobs.insert(job_id.clone(), pid);
    }

    let file_jobs = state.file_jobs.clone();
    let job_id_clone = job_id.clone();
    let language_clone = language.clone();
    let file_path_clone = file_path.clone();

    // Spawn a thread to read stderr for progress and wait for completion
    std::thread::spawn(move || {
        let start = std::time::Instant::now();

        // Read stderr for progress lines: "whisper_full_with_state: progress = XX%"
        if let Some(stderr) = child.stderr.take() {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if let Some(pct) = parse_progress(&line) {
                        let _ = app.emit(
                            "file-job-progress",
                            FileJobProgress {
                                job_id: job_id_clone.clone(),
                                progress: pct,
                            },
                        );
                    }
                }
            }
        }

        let status = child.wait();
        let duration_ms = start.elapsed().as_millis() as u64;

        // Remove from active jobs
        if let Ok(mut jobs) = file_jobs.lock() {
            jobs.remove(&job_id_clone);
        }

        let (text, error) = match status {
            Ok(exit) if exit.success() => {
                // Read stdout
                let mut text = String::new();
                if let Some(mut stdout) = child.stdout.take() {
                    use std::io::Read;
                    let _ = stdout.read_to_string(&mut text);
                }
                let text = text.trim().to_string();

                // Fallback: check for .txt output file
                let txt_path = format!("{}.txt", file_path_clone);
                let text = if text.is_empty() && std::path::Path::new(&txt_path).exists() {
                    let file_text =
                        std::fs::read_to_string(&txt_path).unwrap_or_default();
                    let _ = std::fs::remove_file(&txt_path);
                    file_text.trim().to_string()
                } else {
                    text
                };

                // Apply dictionary
                let text = dict.apply_corrections(&text);
                (text, None)
            }
            Ok(_) => (String::new(), Some("Whisper exited with error".to_string())),
            Err(e) => (String::new(), Some(format!("Process error: {}", e))),
        };

        let _ = app.emit(
            "file-job-done",
            FileJobResult {
                job_id: job_id_clone,
                text,
                language: language_clone,
                duration_ms,
                error,
            },
        );
    });

    Ok(())
}

/// Cancel a running file transcription job.
#[tauri::command]
async fn cancel_file_job(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<(), String> {
    let pid = {
        let mut jobs = state.file_jobs.lock().map_err(|e| e.to_string())?;
        jobs.remove(&job_id)
    };

    if let Some(pid) = pid {
        // Kill the whisper process
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .creation_flags(0x08000000u32)
                .output();
        }
        #[cfg(not(target_os = "windows"))]
        {
            unsafe {
                libc::kill(pid as i32, libc::SIGTERM);
            }
        }
    }
    Ok(())
}

fn parse_progress(line: &str) -> Option<u32> {
    // whisper.cpp outputs: "whisper_full_with_state: progress = XX%"
    if line.contains("progress =") {
        let parts: Vec<&str> = line.split("progress =").collect();
        if parts.len() > 1 {
            let pct_str = parts[1].trim().trim_end_matches('%').trim();
            return pct_str.parse::<u32>().ok();
        }
    }
    None
}

#[tauri::command]
async fn get_audio_devices() -> Result<Vec<String>, String> {
    audio::list_input_devices().map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_audio_level(state: State<'_, AppState>) -> Result<f32, String> {
    let rec = state.recorder.lock().map_err(|e| e.to_string())?;
    if let Some(recorder) = rec.as_ref() {
        let level = recorder.level.lock().map_err(|e| e.to_string())?;
        Ok(*level)
    } else {
        Ok(0.0)
    }
}

#[tauri::command]
async fn save_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn type_text(text: String) -> Result<(), String> {
    use enigo::{Enigo, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| {
        #[cfg(target_os = "macos")]
        {
            return format!(
                "Cannot simulate keyboard input. Please grant Accessibility permissions: \
                 System Settings > Privacy & Security > Accessibility. Error: {}",
                e
            );
        }
        #[cfg(not(target_os = "macos"))]
        e.to_string()
    })?;
    enigo.text(&text).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn run() {
    env_logger::init();

    // Add the bundled bin/ resource directory to the library search path
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let bin_dir = exe_dir.join("_up_").join("bin");
            if bin_dir.exists() {
                let sep = if cfg!(windows) { ";" } else { ":" };
                if let Ok(current_path) = std::env::var("PATH") {
                    std::env::set_var(
                        "PATH",
                        format!("{}{}{}", bin_dir.to_string_lossy(), sep, current_path),
                    );
                }
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::ffi::OsStrExt;
                    let wide: Vec<u16> = bin_dir
                        .as_os_str()
                        .encode_wide()
                        .chain(std::iter::once(0))
                        .collect();
                    unsafe {
                        #[link(name = "kernel32")]
                        extern "system" {
                            fn AddDllDirectory(path: *const u16) -> *mut std::ffi::c_void;
                            fn SetDefaultDllDirectories(flags: u32) -> i32;
                        }
                        SetDefaultDllDirectories(0x00001000);
                        AddDllDirectory(wide.as_ptr());
                    }
                }
                log::info!("Added library search path: {}", bin_dir.display());
            }
        }
    }

    let settings = settings::load_settings().unwrap_or_default();
    let dictionary = dictionary::load_dictionary().unwrap_or_default();

    let ui_language = settings.ui_language.clone();

    // Auto-load the model at startup so speech recognition is ready immediately.
    // Check file size > 1 KB to skip Git LFS pointer files (~134 bytes).
    let model_path = std::path::Path::new(&settings.model_path);
    let is_real_model = !settings.model_path.is_empty()
        && model_path.exists()
        && model_path.metadata().map(|m| m.len() > 1024).unwrap_or(false);
    let initial_transcriber = if is_real_model {
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus the existing window when a second instance is launched
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(AppState {
            transcriber: Arc::new(Mutex::new(initial_transcriber)),
            recorder: Arc::new(Mutex::new(None)),
            settings: Arc::new(Mutex::new(settings)),
            dictionary: Arc::new(Mutex::new(dictionary)),
            is_recording: Arc::new(Mutex::new(false)),
            file_jobs: Arc::new(Mutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_available_models,
            download_model,
            delete_model,
            load_model,
            start_recording,
            stop_recording,
            get_recording_status,
            get_dictionary,
            save_dictionary,
            add_dictionary_word,
            remove_dictionary_word,
            start_file_job,
            cancel_file_job,
            get_audio_devices,
            get_audio_level,
            is_model_loaded,
            save_text_file,
            type_text,
        ])
        .setup(move |app| {
            // Config has decorations:true + titleBarStyle:overlay for macOS traffic lights.
            // On Windows/Linux, disable decorations at runtime for our custom titlebar.
            #[cfg(not(target_os = "macos"))]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                }
            }

            // Build system tray menu with localised labels
            let (show_l, enabled_l, quit_l) = match ui_language.as_str() {
                "nl" => ("Tonen", "Ingeschakeld", "Afsluiten"),
                "de" => ("Anzeigen", "Aktiviert", "Beenden"),
                "fr" => ("Afficher", "Activ\u{00e9}", "Quitter"),
                "es" => ("Mostrar", "Activado", "Salir"),
                "pt" => ("Mostrar", "Ativado", "Sair"),
                "it" => ("Mostra", "Attivato", "Esci"),
                "pl" => ("Poka\u{017c}", "W\u{0142}\u{0105}czony", "Zako\u{0144}cz"),
                "ru" => ("\u{041f}\u{043e}\u{043a}\u{0430}\u{0437}\u{0430}\u{0442}\u{044c}", "\u{0412}\u{043a}\u{043b}\u{044e}\u{0447}\u{0435}\u{043d}\u{043e}", "\u{0412}\u{044b}\u{0445}\u{043e}\u{0434}"),
                "tr" => ("G\u{00f6}ster", "Etkin", "\u{00c7}\u{0131}k\u{0131}\u{015f}"),
                "zh" => ("\u{663e}\u{793a}", "\u{5df2}\u{542f}\u{7528}", "\u{9000}\u{51fa}"),
                "ja" => ("\u{8868}\u{793a}", "\u{6709}\u{52b9}", "\u{7d42}\u{4e86}"),
                "ko" => ("\u{d45c}\u{c2dc}", "\u{d65c}\u{c131}\u{d654}", "\u{c885}\u{b8cc}"),
                "uk" => ("\u{041f}\u{043e}\u{043a}\u{0430}\u{0437}\u{0430}\u{0442}\u{0438}", "\u{0423}\u{0432}\u{0456}\u{043c}\u{043a}\u{043d}\u{0435}\u{043d}\u{043e}", "\u{0412}\u{0438}\u{0445}\u{0456}\u{0434}"),
                "cs" => ("Zobrazit", "Povoleno", "Ukon\u{010d}it"),
                "ro" => ("Afi\u{0219}are", "Activat", "Ie\u{0219}ire"),
                "hu" => ("Megjelen\u{00ed}t\u{00e9}s", "Enged\u{00e9}lyezve", "Kil\u{00e9}p\u{00e9}s"),
                "sv" => ("Visa", "Aktiverad", "Avsluta"),
                "da" => ("Vis", "Aktiveret", "Afslut"),
                "no" => ("Vis", "Aktivert", "Avslutt"),
                "fi" => ("N\u{00e4}yt\u{00e4}", "K\u{00e4}yt\u{00f6}ss\u{00e4}", "Lopeta"),
                "el" => ("\u{0395}\u{03bc}\u{03c6}\u{03ac}\u{03bd}\u{03b9}\u{03c3}\u{03b7}", "\u{0395}\u{03bd}\u{03b5}\u{03c1}\u{03b3}\u{03bf}\u{03c0}\u{03bf}\u{03b9}\u{03b7}\u{03bc}\u{03ad}\u{03bd}\u{03bf}", "\u{0388}\u{03be}\u{03bf}\u{03b4}\u{03bf}\u{03c2}"),
                "bg" => ("\u{041f}\u{043e}\u{043a}\u{0430}\u{0436}\u{0438}", "\u{0412}\u{043a}\u{043b}\u{044e}\u{0447}\u{0435}\u{043d}\u{043e}", "\u{0418}\u{0437}\u{0445}\u{043e}\u{0434}"),
                "hr" => ("Prika\u{017e}i", "Omogu\u{0107}eno", "Iza\u{0111}i"),
                "sk" => ("Zobrazi\u{0165}", "Povolen\u{00e9}", "Ukon\u{010d}i\u{0165}"),
                _    => ("Show", "Enabled", "Quit"),
            };

            let title_i   = MenuItem::with_id(app, "title", "Open Speech Studio", false, None::<&str>)?;
            let sep1      = PredefinedMenuItem::separator(app)?;
            let show_i    = MenuItem::with_id(app, "show", show_l, true, None::<&str>)?;
            let enabled_i = CheckMenuItem::with_id(app, "enabled", enabled_l, true, true, None::<&str>)?;
            let sep2      = PredefinedMenuItem::separator(app)?;
            let quit_i    = MenuItem::with_id(app, "quit", quit_l, true, None::<&str>)?;

            let menu = Menu::with_items(app, &[
                &title_i, &sep1, &show_i, &enabled_i, &sep2, &quit_i,
            ])?;

            // Build tray icon
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Open Speech Studio")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "enabled" => {
                        // CheckMenuItem toggles automatically; read current state and notify frontend
                        if let Some(window) = app.get_webview_window("main") {
                            if let Some(item) = app.menu().and_then(|m| m.get("enabled")) {
                                if let Some(check) = item.as_check_menuitem() {
                                    if let Ok(checked) = check.is_checked() {
                                        let _ = window.emit("app-enabled-changed", checked);
                                    }
                                }
                            }
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Emit startup-ready event so frontend can show notification
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("app-ready", "Open Speech Studio");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Minimize to tray on close instead of quitting
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Open Speech Studio");
}
