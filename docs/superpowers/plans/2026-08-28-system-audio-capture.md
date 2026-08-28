# System audio capture — Implementation Plan

Spec: `docs/superpowers/specs/2026-08-28-system-audio-capture-design.md`
Issue: #18

**Goal:** Record microphone + system (loopback) audio into one mixed 16 kHz stream when
the user marks a meeting as "online", so remote participants reach the transcript.

**Architecture:** WASAPI loopback via cpal 0.15.3 (no new dependency — cpal sets
`AUDCLNT_STREAMFLAGS_LOOPBACK` itself on a render device). Two cpal streams write into
one timestamp-addressed timeline, OBS-style, so silence on the system source stays
silence instead of drifting.

## Global constraints

- No new Rust or npm dependencies.
- Sample rate on the timeline: 16 kHz mono, `f32`.
- Drain margin: 300 ms. Clock origin: first microphone packet.
- Dictation stays microphone-only, always.
- Windows only; other platforms fall back to microphone-only with a message.
- New i18n keys go in `en.ts` and `nl.ts` only (`t()` falls back to English).
- Build: `npm run build` must run once so `../dist` exists before `cargo test`.

---

### Task 1: `TimelineMixer` (TDD)

- Create `src-tauri/src/mixer.rs`: `write(offset_ns, &[f32])`, `take()` (leaves 300 ms),
  `take_all()`, `clear()`. Positions from `offset_ns / 62_500`; gaps zero-filled;
  overlaps summed and clamped to ±1.0; writes below the drained point dropped.
- Unit tests in the same file: gap→silence, out-of-order writes, overlap sums,
  clamping, `take` margin + a later write still landing right, stale write dropped.
- Register `mod mixer;` in `lib.rs`.
- Verify: `npm run build && cargo test --manifest-path src-tauri/Cargo.toml`
- Commit.

### Task 2: Capture in `audio.rs` (TDD for the pure parts)

- Add `CaptureMode`, `CaptureConfig`, pure `resolve_device_name()` and `to_mono_16k()`
  with unit tests.
- `AudioRecorder`: replace the `Vec<f32>` buffer with the mixer; two streams (`mic`,
  `system`); shared `origin: Option<cpal::StreamInstant>` set by the first mic packet;
  per-source level; `system_last_packet_ms`. Dictation buffer fed by the mic stream only.
- `start(&CaptureConfig)`, `ensure_system_stream()`, `clear_buffer()`,
  `list_output_devices()`. A failing loopback stream logs and continues mic-only.
- Update call sites in `lib.rs` (`start_recording`, `start_dictation`).
- Verify: `cargo test` + `cargo build`.
- Commit.

### Task 3: Settings + commands

- `settings.rs`: add `system_audio_device` (default `"default"`); `audio_device` now
  actually read.
- `lib.rs`: `start_recording(system_audio: Option<bool>)`, new `get_output_devices` and
  `get_system_audio_status` → `{ active, level, last_packet_ms_ago }`; register all three.
  `get_audio_level` unchanged.
- Verify: `cargo build`.
- Commit.

### Task 4: Frontend API

- `api.ts`: `system_audio_device?` on `Settings`; `startRecording(systemAudio?)`,
  `getOutputDevices`, `getSystemAudioStatus` on both `tauriApi` and `browserApi`.
- Verify: `npm run build`.
- Commit.

### Task 5: Meeting type + system meter

- `MeetingRecorder.tsx`: meeting-type selector (physical / online), locked while
  recording, disabled outside Tauri; pass the flag in `startRecording` and
  `captureSegment`; poll `getSystemAudioStatus` for a second level meter and a
  "no PC audio for 30 s" warning.
- i18n keys in `en.ts` + `nl.ts`.
- Verify: `npm run build`, then `npm run tauri dev` with a real call.
- Commit.

### Task 6: Settings UI + README

- `SettingsPanel.tsx`: *System audio device* dropdown from `getOutputDevices()`.
- i18n keys; short README note.
- Verify: `npm run build`.
- Commit, push, open PR against `main` closing #18.
