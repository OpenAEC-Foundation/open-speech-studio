# Open Speech Studio v0.7 — Design Spec

## Overview

Major feature expansion introducing parallel multi-cursor transcription, incremental chunked processing, meeting enhancements with speaker diarization, local LLM auto-correction, retro game sounds with preference learning, and UI improvements.

**Version**: 0.7.0
**Date**: 2026-04-03
**Status**: Design approved

---

## 1. Multi-cursor Transcription

### Problem
Currently a user can only dictate in one window at a time and must wait for transcription to complete before dictating elsewhere. Users want to dictate in Word for 20s, switch to Outlook for 10s, then Claude for 20s, with all three transcriptions running in parallel and each result pasted back into the correct window.

### Design

#### TranscriptionJob
Each dictation or meeting chunk becomes a job submitted to a central queue.

```rust
struct TranscriptionJob {
    id: Uuid,
    audio: Vec<f32>,
    target_hwnd: usize,        // Window handle to paste result into
    language: String,
    job_type: JobType,          // Dictation | MeetingSegment
    chunk_index: Option<u32>,   // For incremental: which chunk in sequence
    session_id: Uuid,           // Groups chunks from same dictation
    created_at: Instant,
    status: JobStatus,          // Queued | Processing | Done | Failed
}

enum JobType {
    Dictation,
    MeetingSegment,
}
```

#### JobQueue with Worker Pool
A queue manages all pending jobs. A configurable pool of whisper.cpp worker processes (1-3, default 2) picks jobs and transcribes them in parallel.

```rust
struct JobQueue {
    queue: VecDeque<TranscriptionJob>,
    active: HashMap<Uuid, TranscriptionJob>,
    completed: Vec<JobResult>,
    max_workers: usize,  // Configurable in settings (1-3)
}

struct JobResult {
    job_id: Uuid,
    session_id: Uuid,
    chunk_index: Option<u32>,
    text: String,
    speaker: Option<String>,   // For meeting segments
    duration_ms: u64,
    progress_pct: u8,          // From whisper.cpp stderr
}
```

Methods:
- `submit(job) -> Uuid` — Add job to queue, wake idle worker
- `poll_results() -> Vec<JobResult>` — Collect completed results
- `cancel(job_id)` — Kill worker process for this job
- `get_queue_status() -> QueueStatus` — For UI progress display

#### DictationSession
Each dictation in a specific window is a session that tracks its chunks and reassembles results in order.

```rust
struct DictationSession {
    id: Uuid,
    target_hwnd: usize,
    language: String,
    chunks: Vec<Option<String>>,  // Indexed by chunk_index, None = pending
    status: SessionStatus,        // Recording | Transcribing | Done
}
```

When all chunks for a session complete, the results are concatenated in order and pasted into the target window via `SetForegroundWindow(hwnd)` + `enigo.text()`.

**Paste ordering:** When multiple sessions complete around the same time, they are pasted in FIFO order (earliest completion first). A brief 100ms delay between pastes ensures the OS has time to switch window focus.

#### Flow
1. User presses hotkey in Word → capture HWND, create DictationSession, start recording
2. User releases hotkey → stop recording, split audio into chunks (if incremental), submit jobs to queue
3. User immediately presses hotkey in Outlook → new DictationSession with different HWND
4. Workers process Word chunks and Outlook chunks in parallel
5. When Word session completes: `SetForegroundWindow(word_hwnd)`, type text, restore focus
6. When Outlook session completes: same for Outlook HWND

---

## 2. Incremental Transcription

### Problem
Long dictations (20s+) have a long wait time. Users want partial results sooner.

### Design

The recording is split into chunks at a configurable interval. Each chunk is submitted as a separate job.

#### IncrementalRecorder
```rust
struct IncrementalRecorder {
    interval_secs: f32,       // Configurable in settings (1-60s, default 5)
    buffer: Vec<f32>,
    chunks_submitted: u32,
    session_id: Uuid,
    target_hwnd: usize,
    timer: Option<Timer>,
}
```

**Behavior during recording:**
- Every `interval_secs`, take the accumulated audio buffer, create a TranscriptionJob with `chunk_index = chunks_submitted`, submit to queue, clear buffer, increment counter.
- On recording stop: submit the remaining buffer as the final chunk.

**"Live mode"** is simply setting the interval to 1-2 seconds. No separate mode needed — the same mechanism, just shorter intervals. The settings UI presents this as a single slider.

**Quality tradeoff:** Shorter intervals mean less audio context per chunk, which reduces transcription quality. The UI should communicate this: "Korter = sneller, maar minder nauwkeurig".

---

## 3. Meeting Transcription Enhancements

### 3a. Crash-safe Persistent Storage

#### Problem
If the app or system crashes during a meeting, all transcription is lost.

#### Design
Each meeting segment is written to disk immediately after transcription.

**File structure:**
```
{meeting_save_dir}/
├── 2026-04-03_meeting_14-30.md      # Human-readable transcript
├── 2026-04-03_meeting_14-30.json    # Metadata + timestamps
└── ...
```

**Markdown format:**
```markdown
# Meeting — 2026-04-03 14:30

[14:30:05] Rick: Goedemiddag allemaal, welkom bij deze vergadering.
[14:30:12] Onbekend 1: Hallo Rick, bedankt voor de uitnodiging.
[14:30:18] Rick: Laten we beginnen met het eerste agendapunt.
```

**JSON format (metadata):**
```json
{
  "meeting_id": "uuid",
  "started_at": "2026-04-03T14:30:00",
  "segments": [
    {
      "timestamp": "14:30:05",
      "speaker": "Rick",
      "speaker_confidence": 0.92,
      "text": "Goedemiddag allemaal...",
      "duration_ms": 4200
    }
  ]
}
```

**Write strategy:**
- After each chunk transcription + speaker identification: append to .md file, update .json file
- Call `file.sync_all()` (fsync) after each write for crash safety
- Meeting save directory is configurable in settings (default: `~/Documents/OSS Meetings/`)

### 3b. Floating Meeting Indicator

A small always-on-top pill-shaped overlay (separate Tauri window) that shows meeting recording status.

**Appearance:** Dark rounded pill (~120x28px) with:
- Colored dot: green (active), orange (saving/transcribing), grey (paused)
- Small microphone icon
- Running timer (HH:MM:SS)

**Window properties:**
- Always on top, no taskbar entry, no decorations
- Transparent background with rounded pill shape
- Position: top-right corner of screen (configurable via drag)
- Separate from DictationOverlay — only visible during meetings

**States:**
| State | Dot color | Mic icon | Timer |
|-------|-----------|----------|-------|
| Recording | Green (glowing) | White, animated | Running |
| Transcribing segment | Orange | White | Running |
| Paused | Grey | Grey | Frozen |

### 3c. Meeting + Dictation Parallel

Already partially implemented (dual buffer system in `audio.rs`). The meeting continues recording to `main_buffer` while dictation uses `dictation_buffer`. With the new job queue, both meeting segment jobs and dictation jobs flow through the same queue and workers process them in parallel.

---

## 4. Speaker Diarization & Voice Training

### Problem
Meeting transcripts don't identify who is speaking. Users want labeled output: "Rick: ... / Persoon 2: ..."

### Design

#### Architecture
Two separate models run in parallel per audio chunk:
1. **Whisper.cpp** → text transcription (existing)
2. **Speaker embedding model** (ECAPA-TDNN via ONNX Runtime) → voice vector (new)

The speaker embedding model is a small (~30MB) neural network that converts an audio segment into a fixed-size vector (embedding) that represents the speaker's voice characteristics.

#### Speaker Matching
```rust
struct SpeakerProfile {
    name: String,
    embedding: Vec<f32>,     // 192-dim vector from ECAPA-TDNN
    created_at: DateTime,
}

struct SpeakerMatcher {
    profiles: Vec<SpeakerProfile>,
    threshold: f32,           // Default 0.75 cosine similarity
    unknown_counter: u32,     // For "Onbekend 1", "Onbekend 2"
}
```

**Matching algorithm:**
1. Extract embedding from audio chunk
2. Compare with all known profiles using cosine similarity
3. If best match > threshold (0.75): assign that speaker's name
4. If no match: assign "Onbekend N" (increment counter), optionally save as new profile

#### Voice Training Wizard

A 3-step UI flow accessible from Settings > Stemprofielen > "Nieuw profiel":

**Step 1: Enter name**
- Text input for speaker name

**Step 2: Read training text**
- App generates a Dutch text (~30 seconds of speech) specifically designed with:
  - Minimal pairs (niet/nit, ui/uil, uur/oor)
  - Difficult Dutch phonemes (sch-, -cht, -nk, g/ch)
  - Tongue twisters for phoneme coverage
  - Words that are commonly confused in speech recognition
- The text is generated per language (Dutch/English/German etc.) using a hardcoded template with phonetically diverse content
- User reads the text aloud while recording
- Visual feedback: recording progress bar (0s → 30s)

**Step 3: Save profile**
- Extract embedding from the recorded audio
- Save as `speaker_{name}.bin` in config directory
- Show confirmation with profile size

**Training text example (Dutch):**
> "De schrijver beschrijft hoe de schroevendraaier naast de schroef lag. Hij wist dat het niet klopte en ook niet zou kloppen. De ui en de uil stonden in het uurboek. Gereed of bereid, het verschil is verschrikkelijk klein. De acht nachten waren koud, maar de gracht bleef onbevroren."

#### Dependencies
- **ONNX Runtime** (Rust crate `ort`): for running the ECAPA-TDNN model
- **Model file**: `ecapa_tdnn.onnx` (~30MB), bundled or downloadable via Model Manager
- No Python dependency — pure Rust + ONNX

---

## 5. Local Auto-correction (LLM)

### Problem
Raw whisper transcription often has grammatical errors, especially in Dutch. Users want automatic cleanup of grammar and sentence structure.

### Design

#### Architecture
Uses **llama.cpp** as a subprocess (same pattern as whisper.cpp) with a small language model.

**Recommended models (user chooses via Model Manager):**
- Phi-3-mini-4k (3.8B params, ~2.3GB GGUF Q4) — best quality/size ratio
- Gemma-2B (~1.5GB GGUF Q4) — lighter alternative

#### Pipeline
```
Raw transcription → llama.cpp prompt → Corrected text
```

**Prompt template:**
```
Corrigeer de volgende spraak-naar-tekst transcriptie. Verbeter grammatica en zinsbouw, maar behoud de oorspronkelijke betekenis. Geef alleen de gecorrigeerde tekst terug, zonder uitleg.

Transcriptie: {raw_text}

Gecorrigeerde tekst:
```

#### Integration
- Optional: toggle in Settings (default: off)
- Runs as post-processing step after dictionary corrections and spellcheck
- Timeout: 10 seconds max (skip if model is too slow)
- The original (uncorrected) text is always preserved in `TranscriptionResult.original_text`

#### Binary management
- `llama-cli` binary shipped in `/bin/` alongside whisper.cpp binary
- LLM model files downloadable via Model Manager (same infrastructure as whisper models)
- GPU support: same CUDA detection as whisper (shares `ggml-cuda.dll`)

---

## 6. Progress Indication

### Problem
Current time estimation is unreliable. Users want to see actual progress.

### Design

Whisper.cpp outputs `progress = XX%` on stderr during transcription. This is already parsed for file transcription jobs. Extend this to all job types.

#### Implementation
- Worker reads stderr line-by-line during transcription
- Emits progress events: `transcription-progress { job_id, session_id, progress_pct }`
- Frontend subscribes to these events
- DictationOverlay shows progress bar (0-100%) instead of time countdown
- For incremental chunks: progress is per-chunk, but the overlay can show overall session progress as `(completed_chunks + current_chunk_progress) / total_chunks`

#### Overlay display
- Recording state: audio level bar (existing, but wider)
- Transcribing state: progress bar with percentage (blue, 0-100%)
- Done state: green checkmark + brief text preview

---

## 7. Overlay Improvements

### Problem
The DictationOverlay flickers when opening and is too large.

### Design

#### Flicker fix
- **Pre-create the window** at app startup with `visible: false`
- On dictation start: set overlay state, then `show()` — no window creation delay
- Add CSS `opacity` transition (0 → 1, 50ms) for smooth fade-in
- On dictation end (after "done" display): `hide()` instead of destroying

#### Smaller size
- Reduce from 280x64px to ~200x48px
- Compact pill shape (border-radius: 24px)
- Remove text labels where icons suffice
- Audio level bar: 100px wide (was ~40px)

#### States
| State | Left element | Center | Right |
|-------|-------------|--------|-------|
| Recording | Red glowing dot | Mic icon | Audio level bar (100px) |
| Transcribing | Blue glowing dot | Spinner icon | Progress bar with % |
| Done | Green glowing dot | Checkmark | Brief text preview |
| Error | Red dot | X icon | Error message |

---

## 8. Retro Game Sound System

### Problem
Current sounds are synthesized tones (Web Audio API). Users want fun, nostalgic game sounds with variety.

### Design

#### Sound Pool
Bundle ~20 royalty-free 8-bit/chiptune WAV files organized by category:

```
sounds/
├── success/       # 15-20 sounds for successful transcription
├── start/         # 3-5 sounds for recording start
├── stop/          # 3-5 sounds for recording stop
└── error/         # 3-5 sounds for errors
```

**Source**: Royalty-free from freesound.org or synthetically generated chiptune samples. No copyrighted game audio. Format: WAV 16-bit mono, 0.3-1.5 seconds.

#### Preference Learning
```typescript
interface SoundPreference {
    file: string;
    likes: number;      // Thumbs up count
    plays: number;      // Times played
    weight: number;     // Calculated selection probability
}
```

**Weight algorithm:**
- Base weight: 1.0 (all sounds start equal)
- After thumbs up: `weight = 1.0 + (likes * 2.0)`
- Never liked after 5+ plays: `weight = max(0.1, 1.0 - plays * 0.1)` (gradually fades out)
- Selection: weighted random pick from pool

**Thumbs up UI:**
- After each successful transcription sound, show a small thumbs-up button in the overlay for 3 seconds
- Click = increment likes for that sound
- Preferences saved to `sound-prefs.json` in config directory

#### Playback
- Replace current Web Audio API synthesis with HTML5 Audio or Web Audio API buffer playback
- Preload all sound files at app startup for instant playback
- Volume: configurable in settings (0-100%, default 70%)

---

## 9. New Settings

### Settings struct additions
```rust
pub struct Settings {
    // ... existing fields ...

    // Transcription
    pub incremental_interval_secs: f32,    // 1-60, default 5
    pub max_workers: usize,                // 1-3, default 2
    pub auto_correct: bool,                // LLM correction, default false
    pub auto_correct_model: String,        // Path to GGUF model

    // Meeting
    pub meeting_save_dir: String,          // Default: ~/Documents/OSS Meetings/
    pub speaker_diarization: bool,         // Default: false
    pub floating_indicator: bool,          // Default: true

    // Sounds
    pub sound_pack: String,               // "retro" (default), "classic" (original tones)
    pub sound_volume: f32,                // 0.0-1.0, default 0.7

    // Speaker profiles stored separately in config dir
}
```

### Settings UI additions

**Transcription tab** (extend existing):
- Incremental interval: slider (1-60s) with label showing tradeoff
- Max parallel workers: dropdown (1, 2, 3)
- Auto-correction: toggle + model selector (like whisper model selector)

**Meeting tab** (new tab):
- Save directory: path picker
- Speaker diarization: toggle
- Floating indicator: toggle
- Speaker profiles: list with "Train new profile" button

**Sounds tab** (new section in existing Audio tab):
- Sound pack: dropdown (Retro Games / Classic Tones)
- Volume: slider with preview button
- Sound history: list of recent sounds with thumbs up/down

---

## 10. Audio Level Bar

### Problem
The RMS audio level bar in the dictation overlay is too narrow to be useful.

### Design
- Increase bar width from ~40px to 100px in the new compact overlay
- Use gradient color (green → yellow → red) based on level
- Smooth animation (CSS transition on width, 80ms update interval — already exists)

---

## Dependencies Summary

| Component | Dependency | Size | Bundled? |
|-----------|-----------|------|----------|
| Worker pool | whisper.cpp (existing) | — | Yes |
| Speaker embedding | ONNX Runtime (`ort` crate) | ~15MB | Yes (Rust crate) |
| Speaker model | ecapa_tdnn.onnx | ~30MB | Downloadable |
| Auto-correction | llama.cpp binary | ~2MB | Bundled in /bin/ |
| LLM model | Phi-3-mini GGUF Q4 | ~2.3GB | Downloadable |
| Sound files | WAV samples | ~2MB total | Bundled |

---

## File Changes Overview

### Rust backend (src-tauri/src/)
- **lib.rs** — Refactor to use JobQueue instead of direct transcriber calls. Add new commands: `submit_dictation_job`, `get_queue_status`, `get_session_results`, `train_speaker`, `list_speaker_profiles`
- **audio.rs** — Add IncrementalRecorder with timer-based chunk submission
- **transcriber.rs** — Refactor into worker that processes jobs from queue, add progress event emission
- **job_queue.rs** (new) — TranscriptionJob, JobQueue, worker pool management
- **speaker.rs** (new) — ONNX-based speaker embedding, SpeakerMatcher, SpeakerProfile management
- **autocorrect.rs** (new) — llama.cpp subprocess wrapper for text correction
- **meeting_writer.rs** (new) — Incremental file writer with fsync, markdown + JSON output
- **settings.rs** — Add new settings fields

### Frontend (src/)
- **App.tsx** — Refactor recording flow to create DictationSessions, submit to queue, handle multi-session results
- **components/DictationOverlay.tsx** — Redesign to compact pill, pre-create window, progress bar
- **components/MeetingIndicator.tsx** (new) — Floating pill overlay for meeting status
- **components/VoiceTraining.tsx** (new) — 3-step training wizard
- **components/SettingsPanel.tsx** — Add new settings sections
- **components/MeetingRecorder.tsx** — Integrate with new meeting writer, show speaker labels
- **lib/sounds.ts** — Replace synthesis with WAV playback, add preference learning, thumbs up tracking
- **lib/api.ts** — Add new Tauri command bindings

### Assets
- **sounds/** (new directory) — Bundled retro WAV files organized by category
- **bin/llama-cli** (new) — llama.cpp binary for auto-correction
- **models/** — ECAPA-TDNN ONNX model (downloadable)

---

## Out of Scope

- Cloud-based transcription or correction (everything runs locally)
- Real-time streaming transcription via WebSocket (incremental chunking achieves similar effect)
- Video recording during meetings
- Multi-language mixing within a single dictation session
- Custom sound upload by users (may be added later)
