/// Debug file logger (eprintln doesn't work for Windows GUI apps)
#[macro_export]
macro_rules! dbg_log {
    ($($arg:tt)*) => {{
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true).append(true)
            .open(r"C:\Users\rickd\oss-debug.txt")
        {
            let _ = writeln!(f, "{}", format!($($arg)*));
        }
    }};
}

mod app_config;
mod audio;
mod auth;
mod autocorrect;
mod convert;
mod dictionary;
mod job_queue;
mod meeting_writer;
mod settings;
mod speaker;
mod transcriber;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{
    Emitter, Manager, State,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};

/// Get localised tray menu labels for Show, Enabled, Quit.
fn tray_labels(lang: &str) -> (&'static str, &'static str, &'static str) {
    match lang {
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
    }
}

pub struct AppState {
    transcriber: Arc<Mutex<Option<transcriber::Transcriber>>>,
    recorder: Arc<Mutex<Option<audio::AudioRecorder>>>,
    settings: Arc<Mutex<settings::Settings>>,
    dictionary: Arc<Mutex<dictionary::Dictionary>>,
    is_recording: Arc<Mutex<bool>>,
    is_dictating: Arc<Mutex<bool>>,
    /// Active file transcription jobs: job_id -> child PID (for cancellation)
    file_jobs: Arc<Mutex<HashMap<String, u32>>>,
    /// The window handle (HWND) that was focused when recording started.
    /// Text will be typed back into this window after transcription completes.
    source_window: Arc<Mutex<usize>>,
    /// The window handle for dictation (separate from meeting source_window).
    dictation_source_window: Arc<Mutex<usize>>,
    /// Job queue for parallel transcription
    job_queue: Arc<Mutex<Option<job_queue::JobQueue>>>,
    /// Active meeting writer for crash-safe transcript storage
    meeting_writer: Arc<Mutex<Option<meeting_writer::MeetingWriter>>>,
    /// ONNX-based speaker embedding matcher for diarization
    speaker_matcher: Arc<Mutex<Option<speaker::SpeakerMatcher>>>,
    /// Optional LLM-based auto-corrector for post-processing transcriptions
    auto_corrector: Arc<Mutex<Option<autocorrect::AutoCorrector>>>,
    /// Handle to stop the incremental dictation timer thread
    incremental_stop: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptionResult {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_text: Option<String>,
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

    // Capture the currently focused window so we can restore it after transcription
    #[cfg(target_os = "windows")]
    {
        #[link(name = "user32")]
        extern "system" {
            fn GetForegroundWindow() -> usize;
        }
        let hwnd = unsafe { GetForegroundWindow() };
        let mut sw = state.source_window.lock().map_err(|e| e.to_string())?;
        *sw = hwnd;
    }

    let mut rec = state.recorder.lock().map_err(|e| e.to_string())?;
    if rec.is_some() {
        // Recorder already exists (kept alive by active dictation) — clear main buffer
        if let Some(recorder) = rec.as_ref() {
            recorder.take_buffer();
        }
    } else {
        let mut recorder = audio::AudioRecorder::new().map_err(|e| e.to_string())?;
        recorder.start().map_err(|e| e.to_string())?;
        *rec = Some(recorder);
    }
    *is_recording = true;

    Ok(())
}

#[tauri::command]
async fn stop_recording(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<TranscriptionResult, String> {
    let is_dictating = *state.is_dictating.lock().map_err(|e| e.to_string())?;

    // Take audio + flip the is_recording flag inside a scope so all
    // MutexGuards are released before we hit any `.await` below — std
    // MutexGuard isn't `Send` and tauri commands require Send futures.
    let audio_data = {
        let mut is_recording = state.is_recording.lock().map_err(|e| e.to_string())?;
        if !*is_recording {
            return Err("Not recording".to_string());
        }

        let mut rec = state.recorder.lock().map_err(|e| e.to_string())?;
        let data = if is_dictating {
            // Dictation still using the recorder — just take the main buffer
            let recorder = rec.as_ref().ok_or("No recorder")?;
            recorder.take_buffer()
        } else {
            // No dictation — destroy recorder as before
            let mut recorder = rec.take().ok_or("No recorder")?;
            recorder.stop().map_err(|e| e.to_string())?
        };

        *is_recording = false;
        data
    };

    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();

    let start = std::time::Instant::now();
    let mut text = if settings.remote_server_enabled {
        let (t, _lang) =
            transcribe_buffer_remote(&app, &audio_data, &settings.language).await?;
        t
    } else {
        let transcriber = {
            let guard = state.transcriber.lock().map_err(|e| e.to_string())?;
            guard.as_ref().ok_or("Model not loaded")?.clone()
        };
        transcriber
            .transcribe(&audio_data, &settings.language)
            .map_err(|e| e.to_string())?
    };
    let duration_ms = start.elapsed().as_millis() as u64;

    // Apply dictionary corrections
    let dict = state.dictionary.lock().map_err(|e| e.to_string())?;
    text = dict.apply_corrections(&text);

    Ok(TranscriptionResult {
        text,
        original_text: None,
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
async fn start_dictation(state: State<'_, AppState>) -> Result<String, String> {
    dbg_log!("[DEBUG] start_dictation called");
    let mut is_dictating = state.is_dictating.lock().map_err(|e| e.to_string())?;
    if *is_dictating {
        dbg_log!("[DEBUG] already dictating");
        return Ok(uuid::Uuid::new_v4().to_string());
    }

    // Capture the currently focused window for auto-paste after dictation
    #[allow(unused_mut)]
    let mut hwnd: usize = 0;
    #[cfg(target_os = "windows")]
    {
        #[link(name = "user32")]
        extern "system" {
            fn GetForegroundWindow() -> usize;
        }
        hwnd = unsafe { GetForegroundWindow() };
        let mut sw = state.dictation_source_window.lock().map_err(|e| e.to_string())?;
        *sw = hwnd;
        drop(sw);
        // Also set source_window so type_text works during incremental transcription
        let mut sw2 = state.source_window.lock().map_err(|e| e.to_string())?;
        *sw2 = hwnd;
    }

    let is_recording = *state.is_recording.lock().map_err(|e| e.to_string())?;

    let mut rec = state.recorder.lock().map_err(|e| e.to_string())?;
    if is_recording {
        // Meeting is active — enable dictation buffer on existing recorder
        if let Some(recorder) = rec.as_ref() {
            recorder.start_dictation();
        }
    } else {
        // No meeting — start a fresh recorder for dictation
        let mut recorder = audio::AudioRecorder::new().map_err(|e| e.to_string())?;
        recorder.start().map_err(|e| e.to_string())?;
        recorder.start_dictation();
        *rec = Some(recorder);
    }

    *is_dictating = true;
    // Drop locks before accessing job queue
    drop(rec);
    drop(is_dictating);

    // Create a session in the job queue; fall back to a random UUID if no queue
    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
    let language = settings.language.clone();
    let interval = settings.incremental_interval_secs;

    let session_id = {
        let queue_guard = state.job_queue.lock().map_err(|e| e.to_string())?;
        match queue_guard.as_ref() {
            Some(queue) => queue.create_session(hwnd, language.clone()).to_string(),
            None => uuid::Uuid::new_v4().to_string(),
        }
    };

    // Incremental timer disabled for now — will be re-enabled in stap 2 (live streaming via Tauri events)
    // The timer was stealing audio from the dictation buffer, causing lost speech.
    // The sync flow (stop_dictation_sync) needs all audio intact.
    if false && interval > 0.0 && interval < 300.0 {
        let stop_flag = state.incremental_stop.clone();
        stop_flag.store(false, std::sync::atomic::Ordering::Relaxed);

        let recorder_ref = state.recorder.clone();
        let queue_ref = state.job_queue.clone();
        let session_uuid = uuid::Uuid::parse_str(&session_id)
            .map_err(|e| format!("Invalid session_id: {}", e))?;
        let lang = language.clone();
        let interval_ms = (interval * 1000.0) as u64;

        dbg_log!("[DEBUG] spawning incremental timer thread, interval_ms={}", interval_ms);
        std::thread::spawn(move || {
            let mut chunk_index: u32 = 0;
            dbg_log!("[DEBUG] timer thread started");
            loop {
                std::thread::sleep(std::time::Duration::from_millis(interval_ms));

                if stop_flag.load(std::sync::atomic::Ordering::Relaxed) {
                    dbg_log!("[DEBUG] timer: stop flag set, exiting");
                    break;
                }

                let audio = {
                    let rec = recorder_ref.lock().ok();
                    match rec.as_ref().and_then(|r| r.as_ref()) {
                        Some(recorder) => recorder.take_dictation_chunk(),
                        None => {
                            dbg_log!("[DEBUG] timer: recorder gone, exiting");
                            break;
                        }
                    }
                };

                dbg_log!("[DEBUG] timer: got {} samples from dictation buffer", audio.len());

                if audio.len() < 1600 {
                    dbg_log!("[DEBUG] timer: chunk too small ({}), skipping", audio.len());
                    continue;
                }

                let queue_guard = queue_ref.lock().ok();
                if let Some(Some(queue)) = queue_guard.as_ref().map(|g| g.as_ref()) {
                    dbg_log!("[DEBUG] timer: submitting chunk {} ({} samples)", chunk_index, audio.len());
                    let job = job_queue::TranscriptionJob {
                        id: uuid::Uuid::new_v4(),
                        audio,
                        target_hwnd: hwnd,
                        language: lang.clone(),
                        job_type: job_queue::JobType::Dictation,
                        chunk_index: Some(chunk_index),
                        session_id: session_uuid,
                        created_at: std::time::Instant::now(),
                        status: job_queue::JobStatus::Queued,
                        remote: false,
                    };
                    queue.submit(job);
                    chunk_index += 1;
                } else {
                    break; // no queue, stop timer
                }
            }
        });
    }

    Ok(session_id)
}

/// Synchronous stop-dictation: transcribes immediately and returns the result.
/// Kept for backward compatibility (e.g. file transcription flows).
#[tauri::command]
async fn stop_dictation_sync(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<TranscriptionResult, String> {
    // Take audio + flip the is_dictating flag inside a scope so all std
    // MutexGuards are released before any `.await` (they're not `Send`).
    let audio_data = {
        let mut is_dictating = state.is_dictating.lock().map_err(|e| e.to_string())?;
        if !*is_dictating {
            return Err("Not dictating".to_string());
        }

        let is_recording = *state.is_recording.lock().map_err(|e| e.to_string())?;

        let mut rec = state.recorder.lock().map_err(|e| e.to_string())?;
        let recorder = rec.as_ref().ok_or("No recorder")?;
        let data = recorder.stop_dictation();

        // If no meeting is active, stop the recorder entirely (release mic)
        if !is_recording {
            let mut recorder = rec.take().ok_or("No recorder")?;
            let _ = recorder.stop();
        }

        *is_dictating = false;
        data
    };

    // Restore dictation source window for type_text
    #[cfg(target_os = "windows")]
    {
        let dsw = *state.dictation_source_window.lock().map_err(|e| e.to_string())?;
        let mut sw = state.source_window.lock().map_err(|e| e.to_string())?;
        *sw = dsw;
    }

    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();

    let start = std::time::Instant::now();
    let mut text = if settings.remote_server_enabled {
        let (t, _lang) =
            transcribe_buffer_remote(&app, &audio_data, &settings.language).await?;
        t
    } else {
        let transcriber = {
            let guard = state.transcriber.lock().map_err(|e| e.to_string())?;
            guard.as_ref().ok_or("Model not loaded")?.clone()
        };
        transcriber
            .transcribe(&audio_data, &settings.language)
            .map_err(|e| e.to_string())?
    };
    let duration_ms = start.elapsed().as_millis() as u64;

    // Apply dictionary corrections
    let dict = state.dictionary.lock().map_err(|e| e.to_string())?;
    text = dict.apply_corrections(&text);

    Ok(TranscriptionResult {
        text,
        original_text: None,
        language: settings.language.clone(),
        duration_ms,
    })
}

/// Async stop-dictation: stops the incremental timer, submits remaining audio
/// as final chunk, and finalizes the session. Results come via get_completed_sessions.
#[tauri::command(rename_all = "camelCase")]
async fn stop_dictation(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    dbg_log!("[DEBUG] stop_dictation called with session_id={}", session_id);
    // Signal the incremental timer thread to stop
    state.incremental_stop.store(true, std::sync::atomic::Ordering::Relaxed);

    let mut is_dictating = state.is_dictating.lock().map_err(|e| e.to_string())?;
    if !*is_dictating {
        return Err("Not dictating".to_string());
    }

    let is_recording = *state.is_recording.lock().map_err(|e| e.to_string())?;

    // Get remaining dictation audio (what the timer hasn't grabbed yet)
    let audio_data = {
        let mut rec = state.recorder.lock().map_err(|e| e.to_string())?;
        let recorder = rec.as_ref().ok_or("No recorder")?;
        let data = recorder.stop_dictation();

        // If no meeting is active, stop the recorder entirely (release mic)
        if !is_recording {
            let mut recorder = rec.take().ok_or("No recorder")?;
            let _ = recorder.stop();
        }

        data
    };

    *is_dictating = false;
    drop(is_dictating);

    // Read the HWND that was captured at start_dictation
    let hwnd = *state.dictation_source_window.lock().map_err(|e| e.to_string())?;

    // Restore dictation source window for type_text
    #[cfg(target_os = "windows")]
    {
        let mut sw = state.source_window.lock().map_err(|e| e.to_string())?;
        *sw = hwnd;
    }

    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
    let language = settings.language.clone();

    // Parse the session UUID
    let session_uuid = uuid::Uuid::parse_str(&session_id)
        .map_err(|e| format!("Invalid session_id: {}", e))?;

    // Submit remaining audio as final chunk (the timer already submitted earlier chunks)
    {
        let queue_guard = state.job_queue.lock().map_err(|e| e.to_string())?;
        let queue = queue_guard.as_ref().ok_or("Job queue not initialized")?;

        // Get how many chunks the timer already submitted
        let already_submitted = queue.session_submitted_count(session_uuid);

        // Only submit remaining audio if there's meaningful content
        if audio_data.len() >= 1600 { // at least 0.1s at 16kHz
            let job = job_queue::TranscriptionJob {
                id: uuid::Uuid::new_v4(),
                audio: audio_data,
                target_hwnd: hwnd,
                language: language.clone(),
                job_type: job_queue::JobType::Dictation,
                chunk_index: Some(already_submitted),
                session_id: session_uuid,
                created_at: std::time::Instant::now(),
                status: job_queue::JobStatus::Queued,
                remote: settings.remote_server_enabled,
            };
            queue.submit(job);
            queue.finalize_session_chunks(session_uuid, already_submitted + 1);
        } else {
            // No remaining audio — finalize with chunks already submitted
            queue.finalize_session_chunks(session_uuid, already_submitted);
        }
    }

    Ok(())
}

#[tauri::command]
async fn get_dictation_status(state: State<'_, AppState>) -> Result<bool, String> {
    let is_dictating = state.is_dictating.lock().map_err(|e| e.to_string())?;
    Ok(*is_dictating)
}

#[tauri::command]
async fn is_model_loaded(state: State<'_, AppState>) -> Result<bool, String> {
    let transcriber = state.transcriber.lock().map_err(|e| e.to_string())?;
    Ok(transcriber.is_some())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GpuStatus {
    pub enabled: bool,
    pub cuda_available: bool,
    pub active: bool,
    pub device_name: String,
}

/// Check whether GPU/CUDA is actually active for the loaded model.
#[tauri::command]
async fn get_gpu_status(state: State<'_, AppState>) -> Result<GpuStatus, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    let enabled = settings.use_gpu;

    // Check if ggml-cuda.dll exists next to the whisper binary
    let cuda_available = {
        let transcriber = state.transcriber.lock().map_err(|e| e.to_string())?;
        if let Some(t) = transcriber.as_ref() {
            t.whisper_bin.parent()
                .map(|dir| dir.join("ggml-cuda.dll").exists())
                .unwrap_or(false)
        } else {
            false
        }
    };

    // Quick probe: run whisper-cli --help and check for CUDA device detection
    let (active, device_name) = if enabled && cuda_available {
        let transcriber = state.transcriber.lock().map_err(|e| e.to_string())?;
        if let Some(t) = transcriber.as_ref() {
            let mut cmd = std::process::Command::new(&t.whisper_bin);
            cmd.arg("--help");
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000u32);
            }
            if let Ok(output) = cmd.output() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                // whisper.cpp CUDA build prints: "ggml_cuda_init: found N CUDA devices:"
                // followed by "  Device 0: <name>, compute capability X.Y"
                if stderr.contains("CUDA devices") {
                    let name = stderr.lines()
                        .find(|l| l.contains("Device 0:"))
                        .and_then(|l| l.split("Device 0:").nth(1))
                        .map(|s| s.split(',').next().unwrap_or("").trim().to_string())
                        .unwrap_or_default();
                    (true, name)
                } else {
                    (false, String::new())
                }
            } else {
                (false, String::new())
            }
        } else {
            (false, String::new())
        }
    } else {
        (false, String::new())
    };

    Ok(GpuStatus { enabled, cuda_available, active, device_name })
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

    // Snapshot remote-server settings; if enabled, route to the cloud endpoint
    // and bypass the local whisper.cpp pipeline entirely.
    let (remote_enabled, language_for_remote, dict_for_remote) = {
        let settings = state.settings.lock().map_err(|e| e.to_string())?;
        let d = state.dictionary.lock().map_err(|e| e.to_string())?.clone();
        (settings.remote_server_enabled, settings.language.clone(), d)
    };

    if remote_enabled {
        let url = app_config::get_ai_server_url(&app).await?;
        let token = auth::auth_get_access_token(app.clone())
            .await?
            .ok_or("Sign in to use the cloud transcription server")?;
        return start_remote_file_job(
            app,
            state.file_jobs.clone(),
            job_id,
            file_path,
            url,
            token,
            language_for_remote,
            dict_for_remote,
        );
    }

    // Gather what we need without holding locks long
    let (whisper_bin, model_path, language, use_gpu, dict) = {
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
            settings.use_gpu,
            d,
        )
    };

    // Whisper.cpp only reads WAV 16kHz mono. Convert other formats natively.
    let actual_file = if file_path.to_lowercase().ends_with(".wav") {
        file_path.clone()
    } else {
        let temp_wav = std::env::temp_dir()
            .join(format!("oss_convert_{}.wav", &job_id));
        let temp_path = temp_wav.to_string_lossy().to_string();
        convert::to_wav_16k_mono(&file_path, &temp_path)?;
        temp_path
    };

    let mut cmd = Command::new(&whisper_bin);
    cmd.arg("-m").arg(&model_path);
    cmd.arg("-f").arg(&actual_file);
    cmd.arg("--no-timestamps");
    if !use_gpu {
        cmd.arg("--no-gpu");
    }
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
    let actual_file_clone = actual_file.clone();
    let is_temp_file = actual_file != file_path;

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

        // Clean up temporary WAV conversion
        if is_temp_file {
            let _ = std::fs::remove_file(&actual_file_clone);
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

/// Send a file to the remote transcription server and emit `file-job-done`.
/// Returns immediately; the upload + transcription happens on a background task.
fn start_remote_file_job(
    app: tauri::AppHandle,
    file_jobs: Arc<Mutex<HashMap<String, u32>>>,
    job_id: String,
    file_path: String,
    base_url: String,
    token: String,
    language: String,
    dict: dictionary::Dictionary,
) -> Result<(), String> {
    // Single-endpoint transcribe: the AI server probes the file's duration
    // on arrival and picks the correct op tier (short/long/huge) internally,
    // so the client never sees or cares about credit buckets. No retry
    // dance, no double billing on mis-sized files.
    let url = format!("{}/api/v1/transcribe", base_url.trim_end_matches('/'));

    {
        let mut jobs = file_jobs.lock().map_err(|e| e.to_string())?;
        jobs.insert(job_id.clone(), 0);
    }

    tokio::spawn(async move {
        let start = std::time::Instant::now();
        let result = upload_to_remote(&url, &token, &file_path, &language).await;
        let duration_ms = start.elapsed().as_millis() as u64;

        if let Ok(mut jobs) = file_jobs.lock() {
            jobs.remove(&job_id);
        }

        let (text, lang_out, error) = match result {
            Ok((text, lang)) => (dict.apply_corrections(&text), lang, None),
            Err(e) => {
                // Self-heal: if the AI server returned 5xx or the network
                // tripped, the discovered URL may have moved. Invalidate so
                // the next request refetches /v1/app-config.
                if is_discoverable_failure(&e) {
                    let _ = app_config::invalidate_app_config(app.clone()).await;
                }
                (String::new(), language.clone(), Some(e))
            }
        };

        let _ = app.emit(
            "file-job-done",
            FileJobResult {
                job_id,
                text,
                language: lang_out,
                duration_ms,
                error,
            },
        );
    });

    Ok(())
}

fn is_discoverable_failure(err: &str) -> bool {
    err.starts_with("Network error") || err.contains("Server returned 5")
}

async fn upload_to_remote(
    url: &str,
    token: &str,
    file_path: &str,
    language: &str,
) -> Result<(String, String), String> {
    let bytes = tokio::fs::read(file_path)
        .await
        .map_err(|e| format!("Read failed: {}", e))?;
    let filename = std::path::Path::new(file_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("audio")
        .to_string();
    upload_audio_bytes_to_remote(
        url,
        token,
        bytes,
        filename,
        "application/octet-stream",
        language,
    )
    .await
}

async fn upload_audio_bytes_to_remote(
    url: &str,
    token: &str,
    bytes: Vec<u8>,
    filename: String,
    content_type: &str,
    language: &str,
) -> Result<(String, String), String> {
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(filename)
        .mime_str(content_type)
        .map_err(|e| e.to_string())?;
    let mut form = reqwest::multipart::Form::new().part("audio", part);
    if !language.is_empty() && language != "auto" {
        form = form.text("language", language.to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(url)
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Server returned {}: {}", status, body));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid JSON from server: {}", e))?;
    let text = json
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let lang = json
        .get("language")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok((text, lang))
}

/// Encode 16 kHz mono f32 samples as a WAV/PCM-16 in-memory blob.
fn wav_encode_pcm16(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    use std::io::Write;
    let num_samples = samples.len() as u32;
    let byte_rate = sample_rate * 2;
    let data_size = num_samples * 2;
    let mut out = Vec::with_capacity(44 + data_size as usize);
    out.write_all(b"RIFF").unwrap();
    out.write_all(&(36u32 + data_size).to_le_bytes()).unwrap();
    out.write_all(b"WAVE").unwrap();
    out.write_all(b"fmt ").unwrap();
    out.write_all(&16u32.to_le_bytes()).unwrap();
    out.write_all(&1u16.to_le_bytes()).unwrap();
    out.write_all(&1u16.to_le_bytes()).unwrap();
    out.write_all(&sample_rate.to_le_bytes()).unwrap();
    out.write_all(&byte_rate.to_le_bytes()).unwrap();
    out.write_all(&2u16.to_le_bytes()).unwrap();
    out.write_all(&16u16.to_le_bytes()).unwrap();
    out.write_all(b"data").unwrap();
    out.write_all(&data_size.to_le_bytes()).unwrap();
    for &s in samples {
        let i = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
        out.write_all(&i.to_le_bytes()).unwrap();
    }
    out
}

/// Send a PCM f32 buffer (16 kHz mono) to the AI server's /api/v1/transcribe.
/// Returns (text, detected_language).
pub(crate) async fn transcribe_buffer_remote(
    app: &tauri::AppHandle,
    samples: &[f32],
    language: &str,
) -> Result<(String, String), String> {
    let base_url = app_config::get_ai_server_url(app).await?;
    let token = auth::auth_get_access_token(app.clone())
        .await?
        .ok_or("Sign in to use the cloud transcription server")?;
    let url = format!("{}/api/v1/transcribe", base_url.trim_end_matches('/'));
    let bytes = wav_encode_pcm16(samples, 16000);
    let result = upload_audio_bytes_to_remote(
        &url,
        &token,
        bytes,
        "buffer.wav".to_string(),
        "audio/wav",
        language,
    )
    .await;
    if let Err(e) = &result {
        if is_discoverable_failure(e) {
            let _ = app_config::invalidate_app_config(app.clone()).await;
        }
    }
    result
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GpuInfo {
    pub available: bool,
    pub name: String,
    pub vram_mb: u64,
    pub driver: String,
    pub recommendation: String,
}

#[tauri::command]
async fn get_gpu_info() -> Result<GpuInfo, String> {
    // Try to detect GPU via system commands
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // Try nvidia-smi first (NVIDIA GPUs)
        if let Ok(output) = Command::new("nvidia-smi")
            .args(["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                let parts: Vec<&str> = text.trim().split(", ").collect();
                if parts.len() >= 3 {
                    let name = parts[0].trim().to_string();
                    let vram_mb: u64 = parts[1].trim().parse().unwrap_or(0);
                    let driver = parts[2].trim().to_string();
                    let recommendation = if vram_mb >= 4096 {
                        "GPU acceleration recommended — enough VRAM for all models".to_string()
                    } else if vram_mb >= 2048 {
                        "GPU acceleration useful for small/base models".to_string()
                    } else {
                        "Limited VRAM — CPU may be faster for larger models".to_string()
                    };
                    return Ok(GpuInfo { available: true, name, vram_mb, driver, recommendation });
                }
            }
        }

        // Fallback: WMIC for any GPU
        if let Ok(output) = Command::new("wmic")
            .args(["path", "win32_VideoController", "get", "Name,AdapterRAM,DriverVersion", "/format:csv"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines().skip(1) {
                    let parts: Vec<&str> = line.split(',').collect();
                    if parts.len() >= 4 {
                        let vram_bytes: u64 = parts[1].trim().parse().unwrap_or(0);
                        let vram_mb = vram_bytes / (1024 * 1024);
                        let driver = parts[2].trim().to_string();
                        let name = parts[3].trim().to_string();
                        if name.is_empty() { continue; }
                        let is_dedicated = name.to_lowercase().contains("nvidia")
                            || name.to_lowercase().contains("radeon")
                            || name.to_lowercase().contains("geforce")
                            || name.to_lowercase().contains("arc");
                        let recommendation = if !is_dedicated {
                            "Integrated GPU detected — CPU mode is recommended".to_string()
                        } else if vram_mb >= 4096 {
                            "Dedicated GPU with enough VRAM — GPU acceleration recommended".to_string()
                        } else if vram_mb >= 2048 {
                            "GPU acceleration may help for smaller models".to_string()
                        } else {
                            "Limited VRAM — CPU mode may be faster".to_string()
                        };
                        return Ok(GpuInfo { available: is_dedicated, name, vram_mb, driver, recommendation });
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // macOS/Linux: basic detection
        if let Ok(output) = std::process::Command::new("lspci").output() {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                let lower = line.to_lowercase();
                if lower.contains("vga") || lower.contains("3d") || lower.contains("display") {
                    let name = line.split(':').last().unwrap_or("Unknown GPU").trim().to_string();
                    return Ok(GpuInfo {
                        available: true, name, vram_mb: 0,
                        driver: String::new(),
                        recommendation: "GPU detected — try enabling GPU acceleration".to_string(),
                    });
                }
            }
        }
    }

    Ok(GpuInfo {
        available: false,
        name: "No dedicated GPU detected".to_string(),
        vram_mb: 0,
        driver: String::new(),
        recommendation: "No dedicated GPU found — CPU mode is the best option".to_string(),
    })
}

#[tauri::command]
async fn save_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn update_tray_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    let (show_l, enabled_l, quit_l) = tray_labels(&language);

    // Rebuild the tray menu with new labels
    let title_i   = MenuItem::with_id(&app, "title", "Open Speech Studio", false, None::<&str>).map_err(|e| e.to_string())?;
    let sep1      = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let show_i    = MenuItem::with_id(&app, "show", show_l, true, None::<&str>).map_err(|e| e.to_string())?;
    let enabled_i = CheckMenuItem::with_id(&app, "enabled", enabled_l, true, true, None::<&str>).map_err(|e| e.to_string())?;
    let sep2      = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let quit_i    = MenuItem::with_id(&app, "quit", quit_l, true, None::<&str>).map_err(|e| e.to_string())?;

    let menu = Menu::with_items(&app, &[
        &title_i, &sep1, &show_i, &enabled_i, &sep2, &quit_i,
    ]).map_err(|e| e.to_string())?;

    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn type_text(state: State<'_, AppState>, text: String) -> Result<(), String> {
    // Restore focus to the window that was active when recording started
    #[cfg(target_os = "windows")]
    {
        #[link(name = "user32")]
        extern "system" {
            fn SetForegroundWindow(hwnd: usize) -> i32;
        }
        let hwnd = *state.source_window.lock().map_err(|e| e.to_string())?;
        if hwnd != 0 {
            unsafe { SetForegroundWindow(hwnd); }
            // Brief pause to let the OS complete the focus switch
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }

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

#[tauri::command]
async fn init_job_queue(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    let max_workers = settings.max_workers;
    drop(settings);

    let transcriber_guard = state.transcriber.lock().map_err(|e| e.to_string())?;
    let transcriber = transcriber_guard.clone();
    drop(transcriber_guard);

    let queue = job_queue::JobQueue::new(
        max_workers,
        transcriber,
        Some(app),
        Some(tokio::runtime::Handle::current()),
    );
    *state.job_queue.lock().map_err(|e| e.to_string())? = Some(queue);
    Ok(())
}

#[tauri::command]
fn get_queue_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let queue_guard = state.job_queue.lock().map_err(|e| e.to_string())?;
    let queue = queue_guard.as_ref().ok_or("Job queue not initialized")?;
    let status = queue.get_status();
    serde_json::to_value(&status).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_completed_sessions(state: State<'_, AppState>) -> Result<Vec<(String, usize, String)>, String> {
    let queue_guard = state.job_queue.lock().map_err(|e| e.to_string())?;
    let queue = queue_guard.as_ref().ok_or("Job queue not initialized")?;
    let sessions = queue.get_completed_sessions();
    Ok(sessions.iter().map(|(id, hwnd, text)| (id.to_string(), *hwnd, text.clone())).collect())
}

/// Poll individual chunk results (for live/incremental transcription).
/// Returns completed chunks as (session_id, chunk_index, text, target_hwnd).
/// Results are drained — each chunk is returned only once.
#[tauri::command]
fn poll_chunk_results(state: State<'_, AppState>) -> Result<Vec<(String, u32, String, usize)>, String> {
    let queue_guard = state.job_queue.lock().map_err(|e| e.to_string())?;
    let queue = queue_guard.as_ref().ok_or("Job queue not initialized")?;
    let results = queue.poll_results();
    if !results.is_empty() {
        dbg_log!("[DEBUG] poll_chunk_results: returning {} results", results.len());
        for r in &results {
            dbg_log!("[DEBUG]   chunk {} text='{}'", r.chunk_index.unwrap_or(99), &r.text[..r.text.len().min(50)]);
        }
    }
    Ok(results.iter().map(|r| (
        r.session_id.to_string(),
        r.chunk_index.unwrap_or(0),
        r.text.clone(),
        r.target_hwnd,
    )).collect())
}

// ── Raw audio stop-dictation (for voice training) ───────────────────────

#[tauri::command]
fn stop_dictation_raw(state: State<'_, AppState>) -> Result<Vec<f32>, String> {
    *state.is_dictating.lock().map_err(|e| e.to_string())? = false;
    let is_recording = *state.is_recording.lock().map_err(|e| e.to_string())?;
    let audio = {
        let recorder_guard = state.recorder.lock().map_err(|e| e.to_string())?;
        match &*recorder_guard {
            Some(recorder) => recorder.stop_dictation(),
            None => return Err("No recorder active".to_string()),
        }
    };
    if !is_recording {
        let mut recorder_guard = state.recorder.lock().map_err(|e| e.to_string())?;
        if let Some(mut recorder) = recorder_guard.take() {
            let _ = recorder.stop();
        }
    }
    Ok(audio)
}

// ── Speaker profile management commands ─────────────────────────────────

#[tauri::command]
fn train_speaker(state: State<'_, AppState>, name: String, audio: Vec<f32>) -> Result<(), String> {
    let mut matcher = state.speaker_matcher.lock().map_err(|e| e.to_string())?;
    let matcher = matcher.as_mut().ok_or("Speaker matcher not initialized")?;
    matcher.train_profile(&name, &audio)
}

#[tauri::command]
fn list_speaker_profiles(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let matcher = state.speaker_matcher.lock().map_err(|e| e.to_string())?;
    let matcher = matcher.as_ref().ok_or("Speaker matcher not initialized")?;
    Ok(matcher.list_profiles())
}

#[tauri::command]
fn delete_speaker_profile(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let mut matcher = state.speaker_matcher.lock().map_err(|e| e.to_string())?;
    let matcher = matcher.as_mut().ok_or("Speaker matcher not initialized")?;
    matcher.delete_profile(&name)
}

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .init();

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
            is_dictating: Arc::new(Mutex::new(false)),
            file_jobs: Arc::new(Mutex::new(HashMap::new())),
            source_window: Arc::new(Mutex::new(0)),
            dictation_source_window: Arc::new(Mutex::new(0)),
            job_queue: Arc::new(Mutex::new(None)),
            meeting_writer: Arc::new(Mutex::new(None)),
            speaker_matcher: Arc::new(Mutex::new(None)),
            auto_corrector: Arc::new(Mutex::new(None)),
            incremental_stop: Arc::new(std::sync::atomic::AtomicBool::new(false)),
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
            start_dictation,
            stop_dictation,
            stop_dictation_sync,
            get_dictation_status,
            get_dictionary,
            save_dictionary,
            add_dictionary_word,
            remove_dictionary_word,
            start_file_job,
            cancel_file_job,
            get_audio_devices,
            get_audio_level,
            get_gpu_info,
            get_gpu_status,
            is_model_loaded,
            save_text_file,
            type_text,
            update_tray_language,
            init_job_queue,
            get_queue_status,
            get_completed_sessions,
            poll_chunk_results,
            stop_dictation_raw,
            train_speaker,
            list_speaker_profiles,
            delete_speaker_profile,
            auth::auth_is_configured,
            auth::auth_login,
            auth::auth_logout,
            auth::auth_current_user,
            auth::auth_get_access_token,
            auth::auth_userinfo,
            app_config::get_app_config,
            app_config::invalidate_app_config,
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
            let (show_l, enabled_l, quit_l) = tray_labels(&ui_language);

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
            TrayIconBuilder::with_id("main")
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

            // Windows low-level keyboard hook for Ctrl+Win (OS intercepts this before
            // the global-shortcut plugin sees it, so we need our own hook).
            #[cfg(target_os = "windows")]
            {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    use std::sync::atomic::{AtomicBool, Ordering};
                    use windows_sys::Win32::UI::WindowsAndMessaging::*;
                    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
                    use windows_sys::Win32::Foundation::*;

                    static CTRL_DOWN: AtomicBool = AtomicBool::new(false);
                    static WIN_DOWN: AtomicBool = AtomicBool::new(false);
                    static COMBO_ACTIVE: AtomicBool = AtomicBool::new(false);

                    // We store the app handle in a thread-local so the hook callback can reach it
                    thread_local! {
                        static APP: std::cell::RefCell<Option<tauri::AppHandle>> = std::cell::RefCell::new(None);
                    }
                    APP.with(|a| *a.borrow_mut() = Some(app_handle));

                    unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
                        if code >= 0 {
                            let kb = &*(lparam as *const KBDLLHOOKSTRUCT);
                            let vk = kb.vkCode;
                            let is_down = wparam == WM_KEYDOWN as usize || wparam == WM_SYSKEYDOWN as usize;
                            let is_up = wparam == WM_KEYUP as usize || wparam == WM_SYSKEYUP as usize;

                            // Track Ctrl state
                            if vk == VK_LCONTROL as u32 || vk == VK_RCONTROL as u32 {
                                if is_down { CTRL_DOWN.store(true, Ordering::SeqCst); }
                                if is_up {
                                    CTRL_DOWN.store(false, Ordering::SeqCst);
                                    if COMBO_ACTIVE.swap(false, Ordering::SeqCst) {
                                        APP.with(|a| {
                                            if let Some(ref handle) = *a.borrow() {
                                                let _ = handle.emit("ctrl-win-released", ());
                                            }
                                        });
                                    }
                                }
                            }
                            // Track Win state
                            if vk == VK_LWIN as u32 || vk == VK_RWIN as u32 {
                                if is_down {
                                    WIN_DOWN.store(true, Ordering::SeqCst);
                                    if CTRL_DOWN.load(Ordering::SeqCst) && !COMBO_ACTIVE.load(Ordering::SeqCst) {
                                        COMBO_ACTIVE.store(true, Ordering::SeqCst);
                                        APP.with(|a| {
                                            if let Some(ref handle) = *a.borrow() {
                                                let _ = handle.emit("ctrl-win-pressed", ());
                                            }
                                        });
                                        // Suppress the Win key so the Start menu doesn't open
                                        return 1;
                                    }
                                }
                                if is_up {
                                    WIN_DOWN.store(false, Ordering::SeqCst);
                                    if COMBO_ACTIVE.swap(false, Ordering::SeqCst) {
                                        APP.with(|a| {
                                            if let Some(ref handle) = *a.borrow() {
                                                let _ = handle.emit("ctrl-win-released", ());
                                            }
                                        });
                                        return 1;
                                    }
                                }
                            }
                            // Also suppress Win key while combo is active
                            if COMBO_ACTIVE.load(Ordering::SeqCst) && (vk == VK_LWIN as u32 || vk == VK_RWIN as u32) {
                                return 1;
                            }
                        }
                        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
                    }

                    unsafe {
                        let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), std::ptr::null_mut(), 0);
                        if !hook.is_null() {
                            log::info!("Low-level keyboard hook installed for Ctrl+Win");
                            let mut msg: MSG = std::mem::zeroed();
                            // Message pump (required for LL hooks)
                            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) != 0 {
                                TranslateMessage(&msg);
                                DispatchMessageW(&msg);
                            }
                            UnhookWindowsHookEx(hook);
                        } else {
                            log::error!("Failed to install keyboard hook");
                        }
                    }
                });
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
