use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Transcriber that calls the pre-compiled whisper.cpp binary as a subprocess.
/// No C++ toolchain needed - we ship the binary.
#[derive(Clone)]
pub struct Transcriber {
    pub(crate) whisper_bin: PathBuf,
    pub(crate) model_path: PathBuf,
    use_gpu: bool,
}

impl Transcriber {
    pub fn new(model_path: &str, use_gpu: bool) -> Result<Self, Box<dyn std::error::Error>> {
        let model = PathBuf::from(model_path);
        if !model.exists() {
            return Err(format!("Model not found: {}", model_path).into());
        }

        // Reject files smaller than 1 KB (likely Git LFS pointer files, ~134 bytes)
        let file_size = model.metadata()?.len();
        if file_size < 1024 {
            return Err(format!(
                "Model file is too small ({} bytes). Please download the model first.",
                file_size
            )
            .into());
        }

        let whisper_bin = find_whisper_binary()?;
        log::info!("Using whisper binary: {}", whisper_bin.display());

        // Check if CUDA DLL is available when GPU is requested
        if use_gpu {
            if let Some(bin_dir) = whisper_bin.parent() {
                let cuda_dll = bin_dir.join("ggml-cuda.dll");
                if cuda_dll.exists() {
                    log::info!("CUDA support available: {}", cuda_dll.display());
                } else {
                    log::warn!("GPU requested but ggml-cuda.dll not found — falling back to CPU");
                }
            }
        }

        Ok(Self {
            whisper_bin,
            model_path: model,
            use_gpu,
        })
    }

    /// Apply common whisper.cpp arguments to a command.
    fn apply_common_args(&self, cmd: &mut Command, language: &str) {
        cmd.arg("-m").arg(&self.model_path);
        cmd.arg("--no-timestamps");

        // CUDA build uses GPU by default; pass --no-gpu to force CPU
        if !self.use_gpu {
            cmd.arg("--no-gpu");
        }
        cmd.arg("-t").arg("4");
        cmd.arg("--print-progress");

        if !language.is_empty() && language != "auto" {
            cmd.arg("-l").arg(language);
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
    }

    /// Transcribe an audio/video file directly via whisper.cpp CLI.
    pub fn transcribe_file(
        &self,
        file_path: &str,
        language: &str,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let path = std::path::Path::new(file_path);
        if !path.exists() {
            return Err(format!("File not found: {}", file_path).into());
        }

        let mut cmd = Command::new(&self.whisper_bin);
        cmd.arg("-f").arg(file_path);
        self.apply_common_args(&mut cmd, language);

        log::info!("Running whisper on file: {:?}", cmd);

        let output = cmd.output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Whisper failed: {}", stderr).into());
        }

        let text = String::from_utf8_lossy(&output.stdout)
            .trim()
            .to_string();

        // Also check for .txt output file
        let txt_path = format!("{}.txt", file_path);
        let result = if text.is_empty() && std::path::Path::new(&txt_path).exists() {
            let file_text = std::fs::read_to_string(&txt_path)?;
            let _ = std::fs::remove_file(&txt_path);
            file_text.trim().to_string()
        } else {
            text
        };

        Ok(result)
    }

    /// Transcribe audio samples (f32 mono 16kHz) by writing to a temp WAV file
    /// and calling whisper.cpp CLI.
    pub fn transcribe(
        &self,
        audio_data: &[f32],
        language: &str,
    ) -> Result<String, Box<dyn std::error::Error>> {
        // Write audio to temp WAV file (whisper.cpp expects WAV input)
        let temp_dir = std::env::temp_dir();
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let wav_path = temp_dir.join(format!("oss_{}.wav", ts));
        write_wav(&wav_path, audio_data, 16000)?;

        let mut cmd = Command::new(&self.whisper_bin);
        cmd.arg("-f").arg(&wav_path);
        self.apply_common_args(&mut cmd, language);

        log::info!("Running whisper (gpu={}): {:?}", self.use_gpu, cmd);

        let output = cmd.output()?;

        // Clean up temp file
        let _ = std::fs::remove_file(&wav_path);

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Whisper failed: {}", stderr).into());
        }

        let text = String::from_utf8_lossy(&output.stdout)
            .trim()
            .to_string();

        // Also check for .txt output file (some versions write to file)
        let txt_path = wav_path.with_extension("wav.txt");
        let result = if text.is_empty() && txt_path.exists() {
            let file_text = std::fs::read_to_string(&txt_path)?;
            let _ = std::fs::remove_file(&txt_path);
            file_text.trim().to_string()
        } else {
            text
        };

        Ok(result)
    }

    /// Transcribe audio samples (f32 mono 16kHz) with a progress callback.
    /// Reads stderr line-by-line and parses `progress = XX%` lines emitted by
    /// whisper.cpp when `--print-progress` is active (already added via
    /// `apply_common_args`).
    pub fn transcribe_with_progress<F>(
        &self,
        audio_data: &[f32],
        language: &str,
        on_progress: F,
    ) -> Result<String, Box<dyn std::error::Error>>
    where
        F: Fn(u8) + Send + 'static,
    {
        // Write audio to temp WAV file
        let temp_dir = std::env::temp_dir();
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let wav_path = temp_dir.join(format!("oss_{}.wav", ts));
        write_wav(&wav_path, audio_data, 16000)?;

        let mut cmd = Command::new(&self.whisper_bin);
        cmd.arg("-f").arg(&wav_path);
        self.apply_common_args(&mut cmd, language);
        cmd.stderr(Stdio::piped());
        cmd.stdout(Stdio::piped());

        log::info!("Running whisper with progress (gpu={}): {:?}", self.use_gpu, cmd);

        let mut child = cmd.spawn()?;

        // Drain stderr on a background thread, parsing progress lines.
        let stderr = child.stderr.take().expect("stderr was piped");
        let stderr_thread = std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => break,
                };
                if line.contains("progress =") {
                    if let Some(pct_part) = line.split("progress =").nth(1) {
                        if let Some(pct_str) = pct_part.trim().strip_suffix('%') {
                            if let Ok(pct) = pct_str.trim().parse::<u8>() {
                                on_progress(pct);
                            }
                        }
                    }
                }
            }
        });

        // Read stdout for the transcription result.
        let stdout = child.stdout.take().expect("stdout was piped");
        let mut stdout_text = String::new();
        {
            let mut reader = BufReader::new(stdout);
            use std::io::Read;
            reader.read_to_string(&mut stdout_text)?;
        }

        let status = child.wait()?;
        let _ = stderr_thread.join();

        // Clean up temp file
        let _ = std::fs::remove_file(&wav_path);

        if !status.success() {
            return Err(format!("Whisper failed with status: {}", status).into());
        }

        let text = stdout_text.trim().to_string();

        // Also check for .txt output file (some versions write to file)
        let txt_path = temp_dir.join(format!("oss_{}.wav.txt", ts));
        let result = if text.is_empty() && txt_path.exists() {
            let file_text = std::fs::read_to_string(&txt_path)?;
            let _ = std::fs::remove_file(&txt_path);
            file_text.trim().to_string()
        } else {
            text
        };

        Ok(result)
    }
}

/// Write f32 samples to a 16-bit PCM WAV file (what whisper.cpp expects).
fn write_wav(path: &Path, samples: &[f32], sample_rate: u32) -> Result<(), Box<dyn std::error::Error>> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = hound::WavWriter::create(path, spec)?;
    for &sample in samples {
        let s = (sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
        writer.write_sample(s)?;
    }
    writer.finalize()?;
    Ok(())
}

/// Find the whisper.cpp binary in known locations.
fn find_whisper_binary() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let bin_name = if cfg!(windows) {
        "whisper-cli.exe"
    } else {
        "whisper-cli"
    };

    let alt_name = if cfg!(windows) {
        "main.exe"
    } else {
        "main"
    };

    let mut search_dirs: Vec<PathBuf> = Vec::new();

    // Next to the executable (installed app)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            search_dirs.push(dir.to_path_buf());
            search_dirs.push(dir.join("bin"));
            // Tauri bundles resources into _up_/ directory
            search_dirs.push(dir.join("_up_/bin"));
        }
    }

    // Project root bin/ directory (development)
    if let Ok(cwd) = std::env::current_dir() {
        search_dirs.push(cwd.join("bin"));
        search_dirs.push(cwd.join("../bin"));
    }

    // Config directory
    if let Some(config) = dirs::config_dir() {
        search_dirs.push(config.join("open-speech-studio").join("bin"));
    }

    // System PATH
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(if cfg!(windows) { ';' } else { ':' }) {
            search_dirs.push(PathBuf::from(dir));
        }
    }

    for dir in &search_dirs {
        let path = dir.join(bin_name);
        if path.exists() {
            return Ok(path);
        }
        let path = dir.join(alt_name);
        if path.exists() {
            return Ok(path);
        }
    }

    Err(format!(
        "Whisper binary '{}' not found. Place it in the bin/ directory.",
        bin_name
    )
    .into())
}
