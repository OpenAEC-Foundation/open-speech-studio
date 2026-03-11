use std::path::{Path, PathBuf};
use std::process::Command;

/// Transcriber that calls the pre-compiled whisper.cpp binary as a subprocess.
/// No C++ toolchain needed - we ship the binary.
pub struct Transcriber {
    whisper_bin: PathBuf,
    model_path: PathBuf,
}

impl Transcriber {
    pub fn new(model_path: &str, _use_gpu: bool) -> Result<Self, Box<dyn std::error::Error>> {
        let model = PathBuf::from(model_path);
        if !model.exists() {
            return Err(format!("Model not found: {}", model_path).into());
        }

        let whisper_bin = find_whisper_binary()?;
        log::info!("Using whisper binary: {}", whisper_bin.display());

        Ok(Self {
            whisper_bin,
            model_path: model,
        })
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
        let wav_path = temp_dir.join("oss_recording.wav");
        write_wav(&wav_path, audio_data, 16000)?;

        // Build whisper.cpp command
        let mut cmd = Command::new(&self.whisper_bin);
        cmd.arg("-m").arg(&self.model_path);
        cmd.arg("-f").arg(&wav_path);
        cmd.arg("--no-timestamps");
        cmd.arg("-t").arg("4"); // threads
        cmd.arg("--output-txt"); // plain text output

        // Set language
        if !language.is_empty() && language != "auto" {
            cmd.arg("-l").arg(language);
        }

        log::info!("Running whisper: {:?}", cmd);

        let output = cmd.output()?;

        // Clean up temp file
        let _ = std::fs::remove_file(&wav_path);

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Whisper failed: {}", stderr).into());
        }

        // whisper.cpp with --no-timestamps prints text to stdout
        let text = String::from_utf8_lossy(&output.stdout)
            .trim()
            .to_string();

        // Also check for .txt output file (some versions write to file)
        let txt_path = temp_dir.join("oss_recording.wav.txt");
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
        "Whisper binary '{}' not found. Run 'node setup.js' to download it.",
        bin_name
    )
    .into())
}
