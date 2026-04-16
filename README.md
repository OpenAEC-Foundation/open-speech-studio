# Open Speech Studio

**Open source speech recognition for everyone** — a local AI alternative to Wispr Flow.

Part of the [OpenAEC Foundation](https://github.com/OpenAEC-Foundation).

## Features

- **100% Local** — All speech recognition runs on your own computer. No cloud, no subscription, full privacy.
- **GPU & CPU** — Works on both GPU (CUDA/Vulkan) and CPU. Choose the model that fits your hardware.
- **Multilingual** — Supports 99+ languages with automatic language detection.
- **Dictionary** — Add your own words, names and jargon for better recognition.
- **Universal speech** — Works in any application via a global hotkey.
- **Open source** — Apache 2.0 license. Free to use, modify and distribute.

## Installation

Download the latest installer from the [Releases](https://github.com/OpenAEC-Foundation/open-speech-studio/releases) page.

## Usage

1. Start **Open Speech Studio**
2. Go to **Models** and download a speech model
3. Press **Ctrl+Shift+Space** to start speaking
4. Speak your text
5. Press again to stop — text is automatically inserted

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
