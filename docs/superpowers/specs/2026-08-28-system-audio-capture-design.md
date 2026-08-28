# System audio capture for online meetings — Design Spec

**Date**: 2026-08-28
**Status**: Design approved
**Issue**: [#18 Opnemen en Transcriberen](https://github.com/OpenAEC-Foundation/open-speech-studio/issues/18)

## Problem

The meeting recorder captures the default microphone only. In a Teams, Zoom or Meet
call that means the transcript contains the local user's voice and nothing else —
every remote participant is missing. Users work around this by recording the call in
OBS Studio first and transcribing the resulting file afterwards, which defeats the
purpose of the built-in recorder.

Two smaller defects sit in the same code path:

- `settings.audio_device` is written by the Settings UI and stored, but `audio.rs`
  never reads it. It always opens `host.default_input_device()`. The dropdown does
  nothing.
- There is no way to tell whether meeting audio is actually arriving until the
  recording is over.

## Goals

- Record microphone **and** system (loopback) audio into one mixed 16 kHz mono stream
  during an online meeting, so a single Whisper pass transcribes everyone.
- Keep hotkey dictation microphone-only regardless of meeting state.
- Make the existing input-device setting work.
- Degrade to microphone-only rather than fail when loopback is unavailable.

## Non-goals

- Keeping microphone and system audio as separate tracks for speaker attribution
  ("me" vs "the others"). Attractive for minutes, but it doubles transcription time
  and deserves its own design.
- macOS and Linux loopback capture. cpal has no loopback backend there; the feature
  degrades cleanly and can be added later behind the same interface.
- Per-source gain controls.

## Background: how OBS Studio solves this

OBS's `win-wasapi` desktop-audio source opens a WASAPI client on the **render**
endpoint with `AUDCLNT_STREAMFLAGS_LOOPBACK` — the same call cpal makes. That alone
is not enough: WASAPI delivers no packets while nothing is playing, so a capture that
simply appends samples drifts earlier on every silence.

OBS solves it in the mixer, not the capture. Every packet carries the QPC timestamp
WASAPI supplies with the buffer; each source is resampled to a common rate and written
into a circular buffer **at the position its timestamp implies**; the mixer walks that
timeline in fixed ticks and sums whatever each source contributed, treating a source
that delivered nothing as silence. A timestamp that jumps too far resets that source's
buffer.

This design copies that approach.

## Design

### Capture (`src-tauri/src/audio.rs`)

cpal 0.15.3 already supports Windows loopback: `build_input_stream` on a device whose
data flow is `eRender` sets `AUDCLNT_STREAMFLAGS_LOOPBACK` itself. No new dependency.

`AudioRecorder::start` takes a capture mode and the configured device names:

```rust
pub enum CaptureMode {
    MicOnly,
    MicPlusSystem,
}

pub struct CaptureConfig {
    pub mode: CaptureMode,
    /// Input device name, or None for the system default.
    pub input_device: Option<String>,
    /// Output device to capture via loopback, or None for the system default.
    pub system_device: Option<String>,
}
```

In `MicPlusSystem` the recorder opens two cpal streams:

| Stream | Device source | Config |
| --- | --- | --- |
| microphone | `input_devices()` matched by name, else `default_input_device()` | `default_input_config()` |
| system | `output_devices()` matched by name, else `default_output_device()` | `default_output_config()` |

Both callbacks do what the current one does — RMS level, downmix to mono, linear
resample to 16 kHz — and then write into the shared mixer instead of appending to a
`Vec`. Each keeps its own level value so the UI can show two meters.

The **dictation buffer is fed by the microphone callback only**. An active meeting no
longer risks pulling system audio into a dictation.

### Mixing (`src-tauri/src/mixer.rs`, new)

A new module so the timeline logic is testable without audio hardware and `audio.rs`
stays about devices.

```rust
pub struct TimelineMixer {
    samples: Vec<f32>,
    /// Timestamp (ns) mapped to samples[0]; set by the first write.
    origin_ns: Option<i128>,
    /// Samples already drained, so positions stay absolute across takes.
    drained: usize,
    /// Highest position written so far, for the drain margin.
    head: usize,
}

impl TimelineMixer {
    pub fn write(&mut self, timestamp_ns: i128, samples: &[f32]);
    pub fn take(&mut self) -> Vec<f32>;
    pub fn take_all(&mut self) -> Vec<f32>;
}
```

`write` maps a timestamp to a sample position with `(timestamp_ns - origin_ns) / 62_500`
(16 kHz → 62.5 µs per sample), grows the buffer with zeros up to that position, and
**adds** the samples into place, clamping the sum to ±1.0. Silence in one source is
therefore silence on the timeline, never a shift.

Timestamps come from `InputCallbackInfo::timestamp().capture`, which on WASAPI is an
absolute QPC value — the same clock for both streams, exactly what OBS relies on. If a
device reports no usable timestamp, the callback falls back to a monotonic
`Instant::now()` offset captured when the recorder started. A write landing more than
5 seconds before the current head is treated as a clock reset: it is appended at the
head and logged, mirroring OBS's buffer reset.

`take` drains up to 300 ms behind the head, so a packet from the slower stream is not
lost when the meeting recorder pulls a segment every N minutes. `take_all` drains
everything and is used when the recording stops.

### Settings (`src-tauri/src/settings.rs`)

- `audio_device: String` — existing field, now actually honoured. `"default"` keeps
  meaning the system default.
- `system_audio_device: String` — new, defaults to `"default"`.

The meeting type is deliberately **not** a setting. It is per-recording state owned by
the meeting screen.

### Commands (`src-tauri/src/lib.rs`)

- `start_recording(system_audio: Option<bool>)` — the meeting screen passes the meeting
  type. The parameter is optional so the existing call in `MicTest.tsx` keeps working;
  `None` means microphone-only.
- `get_audio_devices()` — unchanged, input devices.
- `get_output_devices()` — new, for the settings dropdown.
- `get_audio_level()` — **unchanged**, still a bare `f32` microphone level. `App.tsx` and
  `MicTest.tsx` both consume it as a number and stay untouched.
- `get_system_audio_status()` — new: `{ active: bool, receiving: bool, level: f32 }`.
  One command serves both the second level meter and the dead-source warning.

### UI

**`src/components/MeetingRecorder.tsx`** — a meeting-type control above the start
button, disabled while recording:

- *Physical meeting* — microphone only (default).
- *Online meeting* — microphone plus system audio.

A second level meter appears next to the microphone meter in online mode. If the
online mode is on and no system audio has arrived after 30 seconds, the status line
warns that the wrong output device may be selected.

The recorder also runs in browser and server mode, where audio comes from
`getUserMedia` rather than cpal. System audio there would need `getDisplayMedia` and a
user-granted share, which is out of scope: when `isTauri` is false or `isServerMode()`
is true, the online option is disabled with a note explaining that system audio needs
the desktop app.

**`src/components/SettingsPanel.tsx`** — a *System audio device* dropdown next to the
existing *Input device* dropdown, listing output devices with a "Default" entry.

**i18n** — new keys in `src/locales/en.ts` and `src/locales/nl.ts`. `t()` falls back to
English for the other locales, which is already the norm (`de.ts` carries 481 of 622
keys).

### Failure handling

A meeting must never be lost to an audio error.

| Situation | Behaviour |
| --- | --- |
| Loopback stream fails to open (macOS, Linux, no output device) | Log, recording continues microphone-only, UI reports that system audio is unavailable on this platform |
| Output device disappears mid-recording (headphones unplugged) | cpal error callback logs it, microphone keeps recording, status line reports the loss |
| No system samples after 30 s in online mode | Warning in the status line; recording continues |
| Microphone fails to open | Existing behaviour — the recording fails, as it does today |

## Testing

Unit tests on `TimelineMixer`, which needs no audio hardware:

- a gap between two writes becomes exactly the right number of zero samples
- writes arriving out of order land at their timestamps
- overlapping writes sum, and a sum beyond ±1.0 clamps
- `take` leaves the last 300 ms in place; a subsequent write still lands correctly
- a timestamp more than 5 s behind the head appends at the head instead of corrupting
  earlier audio
- the first write sets the origin, so a recording never starts with leading silence

Manual verification on Windows: a Teams call with a second participant, plus a browser
video, confirming both voices appear in one transcript and stay in sync across a
recording long enough to expose drift.
