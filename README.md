# Open Speech Studio

**Open source spraakherkenning en dictatie voor iedereen** - een lokaal AI-alternatief voor Wispr Flow.

Onderdeel van de [OpenAEC Foundation](https://github.com/OpenAEC-Foundation).

## Kenmerken

- **100% Lokaal** - Alle spraakherkenning draait op uw eigen computer. Geen cloud, geen abonnement, volledige privacy.
- **GPU & CPU** - Werkt op zowel GPU (CUDA/Vulkan) als CPU. Kies het model dat past bij uw hardware.
- **Meertalig** - Ondersteunt 99+ talen waaronder Nederlands en Engels met automatische taaldetectie.
- **Woordenboek** - Voeg eigen woorden, namen en vakjargon toe voor betere herkenning.
- **Universele dictatie** - Dicteert in elke applicatie via een globale sneltoets.
- **Spraakmodellen inbegrepen** - Tiny en base model worden automatisch meegeleverd en geladen.
- **Open source** - Apache 2.0 licentie. Vrij te gebruiken, aan te passen en te verspreiden.

## Installatie

Eén commando, werkt op zowel Windows als Linux:

```bash
git clone https://github.com/OpenAEC-Foundation/open-speech-studio.git
cd open-speech-studio
node setup.js
```

Dat is alles. Het setup script:
1. Controleert en installeert alle vereisten (Node.js, Rust, systeembibliotheken)
2. Installeert NPM dependencies
3. Downloadt de Whisper AI spraakmodellen (tiny + base)
4. Bouwt de applicatie met installer

### Opties

```bash
node setup.js              # Volledige installatie + build
node setup.js --dev        # Alleen dependencies (geen build)
node setup.js --cuda       # Met NVIDIA GPU ondersteuning
```

Of via npm:
```bash
npm run setup              # Volledige installatie
npm run setup:dev          # Development modus
npm run setup:cuda         # Met CUDA
```

## Gebruik

Na installatie werkt de app direct - het spraakmodel wordt automatisch geladen bij het opstarten.

1. Start **Open Speech Studio**
2. Druk op **Ctrl+Shift+Space** om te beginnen met dicteren
3. Spreek uw tekst in
4. Druk nogmaals om te stoppen - tekst wordt automatisch ingevoegd

### Woordenboek

Ga naar het **Woordenboek** tabblad om:
- Eigen woorden toe te voegen (namen, afkortingen, technische termen)
- Vervangingen in te stellen (bijv. "OpenAEC" -> "OpenAEC Foundation")

### Grotere modellen

Via het **Modellen** tabblad kunt u extra modellen downloaden voor hogere nauwkeurigheid:

| Model | Grootte | Snelheid | Nauwkeurigheid | Aanbevolen voor |
|-------|---------|----------|----------------|-----------------|
| tiny | 75 MB | Zeer snel | Basis | CPU, snelle notities |
| **base** | **142 MB** | **Snel** | **Goed** | **CPU, dagelijks gebruik** |
| small | 466 MB | Gemiddeld | Zeer goed | GPU of snelle CPU |
| medium | 1.5 GB | Langzaam | Excellent | GPU |
| large-v3 | 3.1 GB | Zeer langzaam | Beste | Krachtige GPU |
| large-v3-turbo | 1.6 GB | Gemiddeld | Bijna beste | GPU |

## Tech Stack

| Component | Technologie |
|-----------|------------|
| Framework | [Tauri 2](https://tauri.app) (Rust) |
| Frontend | [SolidJS](https://solidjs.com) + Vite |
| AI Model | [whisper.cpp](https://github.com/ggml-org/whisper.cpp) via whisper-rs |
| Audio | cpal (Cross-Platform Audio Library) |
| UI Stijl | Office-style ribbon (OpenAEC Foundation) |

## Development

```bash
# Development server starten (na setup:dev)
cargo tauri dev

# Productie build
cargo tauri build

# Met GPU ondersteuning
cargo tauri build --features cuda
```

## Architectuur

```
open-speech-studio/
├── src/                    # SolidJS frontend
│   ├── components/         # UI componenten (Ribbon, Settings, etc.)
│   ├── lib/                # API bindings
│   └── styles/             # CSS
├── src-tauri/              # Rust backend
│   └── src/
│       ├── lib.rs          # Tauri commands & app state
│       ├── transcriber.rs  # Whisper spraakherkenning
│       ├── audio.rs        # Microfoon opname
│       ├── settings.rs     # Configuratie & model auto-detectie
│       └── dictionary.rs   # Woordenboek
├── models/                 # Meegeleverde Whisper modellen (Git LFS)
├── setup.js                # Universele installer
└── index.html              # Entry point
```

## Licentie

Apache License 2.0 - zie [LICENSE](LICENSE)

## Bijdragen

Bijdragen zijn welkom! Open een issue of pull request op GitHub.
