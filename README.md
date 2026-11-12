# Open Speech Studio

**Open source speech recognition for everyone** — a local AI alternative to Wispr Flow.

Part of the [OpenAEC Foundation](https://github.com/OpenAEC-Foundation).

## Features

- **100% Local** — All speech recognition runs on your own computer. No cloud, no subscription, full privacy.
- **GPU & CPU** — Works on both GPU (CUDA/Vulkan) and CPU. Choose the model that fits your hardware.
- **Multilingual** — Supports 99+ languages with automatic language detection.
- **Dictionary** — Add your own words, names and jargon for better recognition.
- **Universal speech** — Works in any application via a global hotkey.
- **Online meetings** — Records your microphone and your PC audio together, so everyone in a Teams, Zoom or Meet call ends up in the transcript (Windows).
- **Open source** — Apache 2.0 license. Free to use, modify and distribute.

## Installation

Download the latest installer from the [Releases](https://github.com/OpenAEC-Foundation/open-speech-studio/releases) page.

## Usage

1. Start **Open Speech Studio**
2. Go to **Models** and download a speech model
3. Press **Ctrl+Shift+Space** to start speaking
4. Speak your text
5. Press again to stop — text is automatically inserted

### Recording a meeting

Open **Record & Transcribe** and pick the meeting type before you start:

- **In-person** — microphone only.
- **Online** — microphone plus PC audio, so the remote participants are transcribed too. Windows only; elsewhere the recording falls back to the microphone.

Pick which output is captured under **Settings → Audio → System audio device**; by
default it follows the Windows default output. The PC level meter next to the
microphone meter shows whether that audio is actually arriving.

### Dictionary

Go to the **Dictionary** tab to:
- Add your own words (names, abbreviations, technical terms)
- Set up replacements (e.g. "OpenAEC" -> "OpenAEC Foundation")

### Models

Via the **Models** tab you can download models for speech recognition:

| Model | Size | Speed | Accuracy | Recommended for |
|-------|------|-------|----------|-----------------|
| tiny | 75 MB | Very fast | Basic | CPU, quick notes |
| **base** | **142 MB** | **Fast** | **Good** | **CPU, daily use** |
| small | 466 MB | Medium | Very good | GPU or fast CPU |
| medium | 1.5 GB | Slow | Excellent | GPU |
| large-v3 | 3.1 GB | Very slow | Best | Powerful GPU |
| large-v3-turbo | 1.6 GB | Medium | Near best | GPU |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | [Tauri 2](https://tauri.app) (Rust) |
| Frontend | [SolidJS](https://solidjs.com) + Vite |
| AI Model | [whisper.cpp](https://github.com/ggml-org/whisper.cpp) via whisper-rs |
| Audio | cpal (Cross-Platform Audio Library) |
| UI Style | Office-style ribbon (OpenAEC Foundation) |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://rustup.rs/)
- Platform-specific dependencies: see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Getting started

```bash
git clone https://github.com/OpenAEC-Foundation/open-speech-studio.git
cd open-speech-studio
npm install
cargo tauri dev
```

### Production build

```bash
cargo tauri build

# With GPU support
cargo tauri build --features cuda
```

## Architecture

```
open-speech-studio/
├── src/                    # SolidJS frontend
│   ├── components/         # UI components (Ribbon, Settings, etc.)
│   ├── lib/                # API bindings
│   └── styles/             # CSS
├── src-tauri/              # Rust backend
│   └── src/
│       ├── lib.rs          # Tauri commands & app state
│       ├── transcriber.rs  # Whisper speech recognition
│       ├── audio.rs        # Microphone recording
│       ├── settings.rs     # Configuration & model auto-detection
│       └── dictionary.rs   # Dictionary
├── models/                 # Whisper models (downloaded via app)
└── index.html              # Entry point
```

## License

Apache License 2.0 — see [LICENSE](LICENSE)

## Contributing

Contributions are welcome! Open an issue or pull request on GitHub.

### Transcription reliability and file formats

Windows releases include an independent CPU-only `whisper-cli-cpu.exe`, built
from whisper.cpp v1.8.3. If GPU mode is disabled, the NVIDIA driver cannot be
loaded, or the CUDA executable fails its startup probe, the app selects this
CPU backend. The existing CUDA backend remains available for NVIDIA systems.
For Windows development, run `pwsh -File scripts/build-whisper-cpu.ps1` once
before starting Tauri (requires CMake and the Visual Studio C++ toolchain).

Local transcription limits previous-text context and suppresses non-speech
tokens. A bundled Silero VAD model skips silence; missing VAD files do not block
transcription. Potential phrase loops are collapsed with a visible review
warning and access to the original text. This cannot recover speech omitted by
the model: check flagged output against the recording.

MP4/M4A/MOV files with a supported AAC audio track are decoded locally. Video-only
files and unsupported audio codecs produce an error; accepting a container does
not imply support for every codec inside it.

New dictionaries include Dutch and English AEC terms. Existing users can choose
**Dictionary → Add Dutch and English AEC terms** without overwriting their own
words or replacements. The words are passed as bounded recognition hints to the
local model; they do not translate the recording or train the model. Removing a
term persists until the user explicitly adds the defaults again.
