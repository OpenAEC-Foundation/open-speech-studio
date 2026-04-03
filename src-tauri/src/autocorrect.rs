use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

pub struct AutoCorrector {
    llama_bin: PathBuf,
    model_path: PathBuf,
    use_gpu: bool,
    timeout_secs: u64,
}

impl AutoCorrector {
    pub fn new(model_path: &Path, use_gpu: bool) -> Result<Self, String> {
        let llama_bin = find_llama_binary().map_err(|e| e.to_string())?;
        if !model_path.exists() {
            return Err(format!("LLM model not found: {:?}", model_path));
        }
        Ok(Self {
            llama_bin,
            model_path: model_path.to_path_buf(),
            use_gpu,
            timeout_secs: 10,
        })
    }

    pub fn correct(&self, text: &str, language: &str) -> Result<String, String> {
        if text.trim().is_empty() {
            return Ok(text.to_string());
        }

        let prompt = match language {
            "nl" => format!(
                "Corrigeer de volgende spraak-naar-tekst transcriptie. Verbeter grammatica en zinsbouw, maar behoud de oorspronkelijke betekenis. Geef alleen de gecorrigeerde tekst terug, zonder uitleg.\n\nTranscriptie: {}\n\nGecorrigeerde tekst:",
                text
            ),
            _ => format!(
                "Correct the following speech-to-text transcription. Fix grammar and sentence structure while preserving the original meaning. Return only the corrected text, no explanation.\n\nTranscription: {}\n\nCorrected text:",
                text
            ),
        };

        let mut cmd = Command::new(&self.llama_bin);
        cmd.args([
            "-m",
            &self.model_path.to_string_lossy(),
            "-p",
            &prompt,
            "-n",
            "256",
            "--temp",
            "0.1",
            "--no-display-prompt",
        ]);
        if !self.use_gpu {
            cmd.arg("--no-gpu");
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        cmd.stdout(Stdio::piped()).stderr(Stdio::null());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start llama-cli: {}", e))?;

        // Read output with timeout
        let timeout_secs = self.timeout_secs;
        let output = std::thread::scope(|s| {
            let stdout_handle = child.stdout.take();
            let handle = s.spawn(move || {
                let mut output = String::new();
                if let Some(mut stdout) = stdout_handle {
                    stdout.read_to_string(&mut output).ok();
                }
                output
            });

            // Wait for completion with timeout
            let start = std::time::Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => {
                        if start.elapsed() > Duration::from_secs(timeout_secs) {
                            let _ = child.kill();
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    Err(_) => break,
                }
            }

            handle.join().unwrap_or_default()
        });

        let corrected = output.trim().to_string();
        if corrected.is_empty() {
            Ok(text.to_string()) // Fallback to original
        } else {
            Ok(corrected)
        }
    }
}

fn find_llama_binary() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let bin_name = if cfg!(windows) {
        "llama-cli.exe"
    } else {
        "llama-cli"
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
    }

    Err(format!(
        "llama-cli binary '{}' not found. Place it in the bin/ directory alongside whisper-cli.",
        bin_name
    )
    .into())
}
