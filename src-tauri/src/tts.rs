// Local text-to-speech via Piper (https://github.com/rhasspy/piper).
//
// Piper is a fast, fully-local neural TTS that runs on CPU. Each voice is a
// small ONNX model (~20-60 MB). We download the Piper binary once and the
// selected voices on demand, then synthesize by piping text through the
// piper executable, which returns a WAV file. No Python, GPU or server.

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Runtime};

const VOICE_BASE: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main/";
const PIPER_WIN_ZIP: &str =
    "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";

// ── Voice registry (curated English + Dutch) ───────────────

struct PiperVoiceDef {
    id: &'static str,
    name: &'static str,
    language: &'static str,
    quality: &'static str,
    size: &'static str,
    /// Path under the piper-voices repo, without extension.
    path: &'static str,
}

const VOICES: &[PiperVoiceDef] = &[
    PiperVoiceDef { id: "nl_NL-pim-medium",       name: "Pim",      language: "Nederlands (NL)", quality: "medium", size: "~60 MB", path: "nl/nl_NL/pim/medium/nl_NL-pim-medium" },
    PiperVoiceDef { id: "nl_NL-ronnie-medium",    name: "Ronnie",   language: "Nederlands (NL)", quality: "medium", size: "~60 MB", path: "nl/nl_NL/ronnie/medium/nl_NL-ronnie-medium" },
    PiperVoiceDef { id: "nl_BE-nathalie-medium",  name: "Nathalie", language: "Nederlands (BE)", quality: "medium", size: "~60 MB", path: "nl/nl_BE/nathalie/medium/nl_BE-nathalie-medium" },
    PiperVoiceDef { id: "nl_BE-rdh-medium",       name: "Rik",      language: "Nederlands (BE)", quality: "medium", size: "~60 MB", path: "nl/nl_BE/rdh/medium/nl_BE-rdh-medium" },
    PiperVoiceDef { id: "en_US-amy-medium",       name: "Amy",      language: "English (US)",    quality: "medium", size: "~60 MB", path: "en/en_US/amy/medium/en_US-amy-medium" },
    PiperVoiceDef { id: "en_US-lessac-medium",    name: "Lessac",   language: "English (US)",    quality: "medium", size: "~60 MB", path: "en/en_US/lessac/medium/en_US-lessac-medium" },
    PiperVoiceDef { id: "en_US-ryan-high",        name: "Ryan",     language: "English (US)",    quality: "high",   size: "~110 MB", path: "en/en_US/ryan/high/en_US-ryan-high" },
    PiperVoiceDef { id: "en_GB-alan-medium",      name: "Alan",     language: "English (GB)",    quality: "medium", size: "~60 MB", path: "en/en_GB/alan/medium/en_GB-alan-medium" },
    PiperVoiceDef { id: "en_GB-jenny_dioco-medium", name: "Jenny",  language: "English (GB)",    quality: "medium", size: "~60 MB", path: "en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium" },
];

fn voice_def(id: &str) -> Option<&'static PiperVoiceDef> {
    VOICES.iter().find(|v| v.id == id)
}

// ── Paths ──────────────────────────────────────────────────

fn piper_dir() -> Result<std::path::PathBuf, String> {
    let dir = dirs::config_dir()
        .ok_or("Cannot find config directory")?
        .join("open-speech-studio")
        .join("piper");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn voices_dir() -> Result<std::path::PathBuf, String> {
    let dir = piper_dir()?.join("voices");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Locate the extracted piper executable, if present.
fn piper_exe() -> Option<std::path::PathBuf> {
    let base = piper_dir().ok()?.join("bin");
    let exe = if cfg!(windows) { "piper.exe" } else { "piper" };
    // The release zip extracts to a top-level `piper/` folder.
    for candidate in [base.join("piper").join(exe), base.join(exe)] {
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn voice_onnx(id: &str) -> Result<std::path::PathBuf, String> {
    Ok(voices_dir()?.join(format!("{}.onnx", id)))
}

fn is_voice_downloaded(id: &str) -> bool {
    voice_onnx(id)
        .map(|p| p.exists() && p.with_extension("onnx.json").exists())
        .unwrap_or(false)
}

// ── Voice info ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PiperVoiceInfo {
    pub id: String,
    pub name: String,
    pub language: String,
    pub quality: String,
    pub size: String,
    pub downloaded: bool,
}

#[tauri::command]
pub async fn tts_get_voices() -> Result<Vec<PiperVoiceInfo>, String> {
    Ok(VOICES
        .iter()
        .map(|v| PiperVoiceInfo {
            id: v.id.to_string(),
            name: v.name.to_string(),
            language: v.language.to_string(),
            quality: v.quality.to_string(),
            size: v.size.to_string(),
            downloaded: is_voice_downloaded(v.id),
        })
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PiperStatus {
    pub binary_installed: bool,
    pub dir: String,
}

#[tauri::command]
pub async fn tts_status() -> Result<PiperStatus, String> {
    Ok(PiperStatus {
        binary_installed: piper_exe().is_some(),
        dir: piper_dir()?.to_string_lossy().to_string(),
    })
}

// ── Binary install ─────────────────────────────────────────

/// Ensure the Piper executable is present, downloading + extracting it once.
async fn ensure_binary<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    if piper_exe().is_some() {
        return Ok(());
    }
    if !cfg!(windows) {
        return Err("Automatic Piper download is only wired up for Windows here.".into());
    }

    let _ = app.emit("tts-download-start", crate::DownloadStart {
        name: "piper".into(),
        dir: piper_dir()?.join("bin").to_string_lossy().to_string(),
    });

    let bin_dir = piper_dir()?.join("bin");
    std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
    let zip_path = piper_dir()?.join("piper.zip");

    download_file(app, "piper", PIPER_WIN_ZIP, &zip_path).await?;

    // Extract with PowerShell Expand-Archive (always available on Win10+).
    let zip_str = zip_path.to_string_lossy().to_string();
    let dest_str = bin_dir.to_string_lossy().to_string();
    let out = tokio::task::spawn_blocking(move || {
        let mut cmd = std::process::Command::new("powershell");
        cmd.args([
            "-NoProfile", "-Command",
            &format!(
                "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                zip_str, dest_str
            ),
        ]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000u32);
        }
        cmd.output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Extract failed: {}", e))?;

    if !out.status.success() {
        return Err(format!("Extract failed: {}", String::from_utf8_lossy(&out.stderr)));
    }
    let _ = std::fs::remove_file(&zip_path);

    if piper_exe().is_none() {
        return Err("Piper binary not found after extraction".into());
    }
    Ok(())
}

// ── Streaming file download with progress ──────────────────

async fn download_file<R: Runtime>(
    app: &tauri::AppHandle<R>,
    name: &str,
    url: &str,
    dest: &std::path::Path,
) -> Result<(), String> {
    let client = reqwest::Client::builder().build().map_err(|e| e.to_string())?;
    let mut resp = client.get(url).send().await.map_err(|e| format!("Network error: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Download failed: server returned {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let total_mb = total / (1024 * 1024);

    let tmp = dest.with_extension("part");
    let mut file = tokio::fs::File::create(&tmp).await.map_err(|e| e.to_string())?;
    use tokio::io::AsyncWriteExt;
    let mut downloaded: u64 = 0;
    let mut last_pct = u32::MAX;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Download error: {}", e))? {
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let pct = if total > 0 { ((downloaded * 100) / total) as u32 } else { 0 };
        if pct != last_pct {
            last_pct = pct;
            let _ = app.emit("tts-download-progress", crate::DownloadProgress {
                name: name.to_string(),
                pct,
                downloaded_mb: downloaded / (1024 * 1024),
                total_mb,
            });
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    tokio::fs::rename(&tmp, dest).await.map_err(|e| format!("Cannot finalize: {}", e))?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn tts_download_voice<R: Runtime>(
    app: tauri::AppHandle<R>,
    voice_id: String,
) -> Result<(), String> {
    let def = voice_def(&voice_id).ok_or("Unknown voice")?;
    ensure_binary(&app).await?;

    if is_voice_downloaded(def.id) {
        let _ = app.emit("tts-download-complete", crate::DownloadComplete {
            name: def.id.to_string(),
            path: voices_dir()?.to_string_lossy().to_string(),
        });
        return Ok(());
    }

    let onnx_url = format!("{}{}.onnx", VOICE_BASE, def.path);
    let json_url = format!("{}{}.onnx.json", VOICE_BASE, def.path);
    let onnx_dest = voice_onnx(def.id)?;
    let json_dest = onnx_dest.with_extension("onnx.json");

    let _ = app.emit("tts-download-start", crate::DownloadStart {
        name: def.id.to_string(),
        dir: voices_dir()?.to_string_lossy().to_string(),
    });

    download_file(&app, &def.id, &onnx_url, &onnx_dest).await?;
    download_file(&app, &def.id, &json_url, &json_dest).await?;

    let _ = app.emit("tts-download-complete", crate::DownloadComplete {
        name: def.id.to_string(),
        path: onnx_dest.to_string_lossy().to_string(),
    });
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn tts_delete_voice(voice_id: String) -> Result<(), String> {
    let onnx = voice_onnx(&voice_id)?;
    let _ = std::fs::remove_file(&onnx);
    let _ = std::fs::remove_file(onnx.with_extension("onnx.json"));
    Ok(())
}

// ── Synthesis ──────────────────────────────────────────────

/// Per-voice synthesis options. All optional; sensible Piper defaults apply.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TtsOptions {
    /// Speaking rate. 1.0 = normal, >1 slower, <1 faster (Piper length_scale).
    pub speed: Option<f32>,
    /// Expressiveness / variation (Piper noise_scale, default 0.667).
    pub expressiveness: Option<f32>,
    /// Pause between sentences in seconds (Piper sentence_silence, default 0.2).
    pub sentence_pause: Option<f32>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn tts_speak<R: Runtime>(
    _app: tauri::AppHandle<R>,
    text: String,
    voice: Option<String>,
    options: Option<TtsOptions>,
) -> Result<Vec<u8>, String> {
    let voice_id = voice.unwrap_or_else(|| "en_US-amy-medium".to_string());
    let def = voice_def(&voice_id).ok_or("Unknown voice")?;
    if !is_voice_downloaded(def.id) {
        return Err("Voice not downloaded yet".into());
    }
    let exe = piper_exe().ok_or("Piper is not installed")?;
    let exe_dir = exe.parent().ok_or("Bad piper path")?.to_path_buf();
    let model = voice_onnx(def.id)?;

    // Unique temp output so concurrent calls don't clash.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let out_wav = std::env::temp_dir().join(format!("oss_tts_{}.wav", stamp));
    let out_str = out_wav.to_string_lossy().to_string();
    let model_str = model.to_string_lossy().to_string();

    // Build optional tuning flags (clamped to sane ranges).
    let opts = options.unwrap_or_default();
    let mut extra: Vec<String> = Vec::new();
    if let Some(s) = opts.speed {
        extra.push("--length_scale".into());
        extra.push(format!("{:.3}", s.clamp(0.3, 3.0)));
    }
    if let Some(e) = opts.expressiveness {
        extra.push("--noise_scale".into());
        extra.push(format!("{:.3}", e.clamp(0.0, 1.5)));
    }
    if let Some(p) = opts.sentence_pause {
        extra.push("--sentence_silence".into());
        extra.push(format!("{:.3}", p.clamp(0.0, 2.0)));
    }

    let result = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let mut cmd = Command::new(&exe);
        cmd.args(["--model", &model_str, "--output_file", &out_str]);
        cmd.args(&extra);
        cmd.current_dir(&exe_dir); // so espeak-ng-data is found next to the exe
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000u32);
        }

        let mut child = cmd.spawn().map_err(|e| format!("Failed to run Piper: {}", e))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        }
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!("Piper failed: {}", String::from_utf8_lossy(&output.stderr)));
        }
        let bytes = std::fs::read(&out_wav).map_err(|e| format!("Cannot read output: {}", e))?;
        let _ = std::fs::remove_file(&out_wav);
        Ok(bytes)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(result)
}

// ── Process monitor (still handy for checking memory use) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub memory_mb: f64,
}

#[tauri::command]
pub async fn get_running_processes() -> Result<Vec<ProcessInfo>, String> {
    let mut processes: Vec<ProcessInfo> = Vec::new();
    #[cfg(target_os = "windows")]
    let patterns = ["whisper-cli", "llama-cli", "piper", "open-speech-studio"];

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        for pattern in &patterns {
            let output = std::process::Command::new("tasklist")
                .args(["/FI", &format!("IMAGENAME eq {}*", pattern), "/FO", "CSV", "/NH"])
                .creation_flags(0x08000000u32)
                .output()
                .map_err(|e| e.to_string())?;
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() >= 5 {
                    let name = parts[0].trim_matches('"').to_string();
                    let pid: u32 = parts[1].trim_matches('"').trim().parse().unwrap_or(0);
                    let mem_str = parts[4].trim_matches('"').replace(" K", "").replace(['.', ','], "");
                    let mem_kb: f64 = mem_str.trim().parse().unwrap_or(0.0);
                    if pid > 0 {
                        processes.push(ProcessInfo { pid, name, memory_mb: mem_kb / 1024.0 });
                    }
                }
            }
        }
    }

    processes.sort_by_key(|p| p.pid);
    processes.dedup_by_key(|p| p.pid);
    Ok(processes)
}

#[tauri::command]
pub async fn kill_process(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .creation_flags(0x08000000u32)
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        unsafe { libc::kill(pid as i32, libc::SIGTERM); }
    }
    Ok(())
}
