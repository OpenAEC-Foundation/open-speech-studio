use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::mixer::{TimelineMixer, SAMPLE_RATE};

/// Sentinel for "no system audio packet has arrived yet".
const NO_PACKET: u64 = u64::MAX;

/// What a recording captures.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureMode {
    /// Microphone only — dictation, and meetings held in a room.
    MicOnly,
    /// Microphone plus whatever the machine is playing, for online meetings.
    MicPlusSystem,
}

#[derive(Debug, Clone)]
pub struct CaptureConfig {
    pub mode: CaptureMode,
    /// Configured input device name, or None/"default" for the system default.
    pub input_device: Option<String>,
    /// Configured output device to capture via loopback, or None/"default".
    pub system_device: Option<String>,
}

impl CaptureConfig {
    pub fn mic_only(input_device: Option<String>) -> Self {
        Self {
            mode: CaptureMode::MicOnly,
            input_device,
            system_device: None,
        }
    }
}

/// Which of the two streams a callback belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StreamRole {
    Mic,
    System,
}

/// Audio capture for one recording. Streams are kept in the struct so dropping
/// it releases the microphone and the loopback client.
pub struct AudioRecorder {
    /// Shared 16 kHz timeline both streams mix into.
    mixer: Arc<Mutex<TimelineMixer>>,
    /// Secondary buffer for dictation — only filled when dictation_active is
    /// true, and only ever by the microphone stream.
    dictation_buffer: Arc<Mutex<Vec<f32>>>,
    /// Flag: when true the microphone callback also writes to dictation_buffer.
    dictation_active: Arc<AtomicBool>,
    /// Current microphone RMS level (0.0–1.0).
    pub level: Arc<Mutex<f32>>,
    /// Current system-audio RMS level (0.0–1.0).
    system_level: Arc<Mutex<f32>>,
    /// Milliseconds after `started_at` at which the last system packet arrived,
    /// or `NO_PACKET`.
    system_last_packet_ms: Arc<AtomicU64>,
    /// Clock origin for the timeline: the capture timestamp of the first
    /// microphone packet. Both streams measure against it, which is what keeps
    /// them aligned — on WASAPI these timestamps are absolute QPC values, so
    /// the microphone and the loopback client share one clock.
    origin: Arc<Mutex<Option<cpal::StreamInstant>>>,
    started_at: Instant,
    mic_stream: Option<cpal::Stream>,
    system_stream: Option<cpal::Stream>,
}

// Safety: the other fields are Send+Sync. cpal::Stream is !Send on some
// platforms, but we never move it across threads — it stays in AudioRecorder
// which is behind Arc<Mutex<>> and only accessed from the main thread.
unsafe impl Send for AudioRecorder {}
unsafe impl Sync for AudioRecorder {}

impl AudioRecorder {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self {
            mixer: Arc::new(Mutex::new(TimelineMixer::new())),
            dictation_buffer: Arc::new(Mutex::new(Vec::new())),
            dictation_active: Arc::new(AtomicBool::new(false)),
            level: Arc::new(Mutex::new(0.0)),
            system_level: Arc::new(Mutex::new(0.0)),
            system_last_packet_ms: Arc::new(AtomicU64::new(NO_PACKET)),
            origin: Arc::new(Mutex::new(None)),
            started_at: Instant::now(),
            mic_stream: None,
            system_stream: None,
        })
    }

    pub fn start(&mut self, config: &CaptureConfig) -> Result<(), Box<dyn std::error::Error>> {
        let host = cpal::default_host();

        let device = open_input_device(&host, config.input_device.as_deref())?;
        let stream = self.build_stream(&device, StreamRole::Mic)?;
        stream.play()?;
        self.mic_stream = Some(stream);

        if config.mode == CaptureMode::MicPlusSystem {
            // A meeting must not fail because system audio is unavailable —
            // an unsupported platform, no output device, a driver that refuses
            // loopback. Log it and keep the microphone running; the UI reports
            // the missing source through `system_active`.
            if let Err(e) = self.ensure_system_stream(config.system_device.as_deref()) {
                log::warn!("System audio capture unavailable, recording microphone only: {e}");
            }
        }

        Ok(())
    }

    /// Open the loopback stream on a recorder that is already running. Used
    /// when a meeting starts while dictation had already opened the recorder.
    pub fn ensure_system_stream(
        &mut self,
        device_name: Option<&str>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if self.system_stream.is_some() {
            return Ok(());
        }
        if !cfg!(target_os = "windows") {
            return Err("system audio capture is only supported on Windows".into());
        }

        let host = cpal::default_host();
        let device = open_output_device(&host, device_name)?;
        // cpal builds an input stream on a render device as a WASAPI loopback
        // client — it sets AUDCLNT_STREAMFLAGS_LOOPBACK itself.
        let stream = self.build_stream(&device, StreamRole::System)?;
        stream.play()?;
        self.system_stream = Some(stream);
        Ok(())
    }

    fn build_stream(
        &self,
        device: &cpal::Device,
        role: StreamRole,
    ) -> Result<cpal::Stream, Box<dyn std::error::Error>> {
        let default_config = match role {
            StreamRole::Mic => device.default_input_config()?,
            // A render endpoint has no input config; its mix format is what
            // the loopback client delivers.
            StreamRole::System => device.default_output_config()?,
        };

        if default_config.sample_format() != cpal::SampleFormat::F32 {
            return Err(format!(
                "{:?} device uses unsupported sample format {:?}",
                role,
                default_config.sample_format()
            )
            .into());
        }

        let device_sample_rate = default_config.sample_rate().0;
        let device_channels = default_config.channels() as usize;

        log::info!(
            "{:?} device: {} channels, {} Hz",
            role,
            device_channels,
            device_sample_rate
        );

        let config = cpal::StreamConfig {
            channels: device_channels as u16,
            sample_rate: cpal::SampleRate(device_sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        let mixer = self.mixer.clone();
        let dictation_buffer = self.dictation_buffer.clone();
        let dictation_active = self.dictation_active.clone();
        let level = match role {
            StreamRole::Mic => self.level.clone(),
            StreamRole::System => self.system_level.clone(),
        };
        let origin = self.origin.clone();
        let last_packet = self.system_last_packet_ms.clone();
        let started_at = self.started_at;

        let stream = device.build_input_stream(
            &config,
            move |data: &[f32], info: &cpal::InputCallbackInfo| {
                if !data.is_empty() {
                    let sum_sq: f32 = data.iter().map(|s| s * s).sum();
                    let rms = (sum_sq / data.len() as f32).sqrt();
                    if let Ok(mut lvl) = level.lock() {
                        *lvl = rms.min(1.0);
                    }
                }

                if role == StreamRole::System {
                    last_packet.store(started_at.elapsed().as_millis() as u64, Ordering::Relaxed);
                }

                // Where on the timeline this packet belongs. The first
                // microphone packet defines position zero; the loopback stream
                // measures against that same origin. A loopback packet that
                // beats the microphone to it has nothing to anchor to and is
                // dropped — that can only be the first few milliseconds.
                let offset_ns = {
                    let Ok(mut origin) = origin.lock() else {
                        return;
                    };
                    match origin.as_ref() {
                        Some(start) => info
                            .timestamp()
                            .capture
                            .duration_since(start)
                            .map(|d| d.as_nanos() as i128)
                            .unwrap_or(0),
                        None => {
                            if role == StreamRole::Mic {
                                *origin = Some(info.timestamp().capture);
                                0
                            } else {
                                return;
                            }
                        }
                    }
                };

                let resampled = to_mono_16k(data, device_channels, device_sample_rate);

                if let Ok(mut mixer) = mixer.lock() {
                    mixer.write(offset_ns, &resampled);
                }

                // Dictation stays microphone-only, so a running meeting can
                // never pull system audio into a dictated sentence.
                if role == StreamRole::Mic && dictation_active.load(Ordering::Relaxed) {
                    if let Ok(mut dbuf) = dictation_buffer.lock() {
                        dbuf.extend_from_slice(&resampled);
                    }
                }
            },
            move |err| {
                log::error!("{role:?} audio stream error: {err}");
            },
            None,
        )?;

        Ok(stream)
    }

    /// Stop recording entirely — drops both streams and returns the timeline.
    pub fn stop(&mut self) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
        self.mic_stream.take();
        self.system_stream.take();
        self.dictation_active.store(false, Ordering::Relaxed);

        let mut mixer = self.mixer.lock().map_err(|e| e.to_string())?;
        Ok(mixer.take_all())
    }

    /// Take the finished part of the timeline, leaving a short tail so a packet
    /// from the slower stream still lands in place (meeting segment capture).
    pub fn take_buffer(&self) -> Vec<f32> {
        self.mixer.lock().map(|mut m| m.take()).unwrap_or_default()
    }

    /// Discard whatever is buffered without transcribing it.
    pub fn clear_buffer(&self) {
        if let Ok(mut mixer) = self.mixer.lock() {
            mixer.clear();
        }
    }

    /// Whether the loopback stream is open.
    pub fn system_active(&self) -> bool {
        self.system_stream.is_some()
    }

    pub fn system_level(&self) -> f32 {
        self.system_level.lock().map(|l| *l).unwrap_or(0.0)
    }

    /// How long ago the last system packet arrived, or None if none has.
    pub fn system_last_packet_ms_ago(&self) -> Option<u64> {
        let stamp = self.system_last_packet_ms.load(Ordering::Relaxed);
        if stamp == NO_PACKET {
            return None;
        }
        Some((self.started_at.elapsed().as_millis() as u64).saturating_sub(stamp))
    }

    /// Start filling the dictation buffer.
    pub fn start_dictation(&self) {
        if let Ok(mut dbuf) = self.dictation_buffer.lock() {
            dbuf.clear();
        }
        self.dictation_active.store(true, Ordering::Relaxed);
    }

    /// Stop filling the dictation buffer and return its contents.
    pub fn stop_dictation(&self) -> Vec<f32> {
        self.dictation_active.store(false, Ordering::Relaxed);
        let mut buf = self.dictation_buffer.lock().unwrap();
        let data = buf.clone();
        buf.clear();
        data
    }

    /// Take current dictation buffer contents WITHOUT stopping dictation.
    /// Used for incremental transcription: grab what we have so far, clear
    /// buffer, keep recording.
    pub fn take_dictation_chunk(&self) -> Vec<f32> {
        let mut buf = self.dictation_buffer.lock().unwrap();
        let data = buf.clone();
        buf.clear();
        data
    }
}

/// Downmix to mono and resample to the timeline's 16 kHz.
fn to_mono_16k(data: &[f32], channels: usize, sample_rate: u32) -> Vec<f32> {
    let mono: Vec<f32> = if channels > 1 {
        data.chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        data.to_vec()
    };

    if sample_rate == SAMPLE_RATE {
        return mono;
    }

    let ratio = sample_rate as f64 / SAMPLE_RATE as f64;
    let out_len = (mono.len() as f64 / ratio) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_idx = i as f64 * ratio;
        let idx = src_idx as usize;
        let frac = src_idx - idx as f64;
        let sample = if idx + 1 < mono.len() {
            mono[idx] * (1.0 - frac as f32) + mono[idx + 1] * frac as f32
        } else if idx < mono.len() {
            mono[idx]
        } else {
            0.0
        };
        out.push(sample);
    }
    out
}

/// Pick which device name to open: the configured one if it is still present,
/// otherwise None, meaning "use the platform default".
fn resolve_device_name(configured: Option<&str>, available: &[String]) -> Option<String> {
    let name = configured?;
    if name.is_empty() || name == "default" {
        return None;
    }
    match available.iter().find(|d| d.as_str() == name) {
        Some(found) => Some(found.clone()),
        None => {
            log::warn!("Configured audio device '{name}' not found, using the default");
            None
        }
    }
}

fn open_input_device(
    host: &cpal::Host,
    configured: Option<&str>,
) -> Result<cpal::Device, Box<dyn std::error::Error>> {
    if let Some(name) = resolve_device_name(configured, &list_input_devices()?) {
        if let Some(device) = host
            .input_devices()?
            .find(|d| d.name().map(|n| n == name).unwrap_or(false))
        {
            return Ok(device);
        }
    }
    host.default_input_device()
        .ok_or_else(|| "No input device available".into())
}

fn open_output_device(
    host: &cpal::Host,
    configured: Option<&str>,
) -> Result<cpal::Device, Box<dyn std::error::Error>> {
    if let Some(name) = resolve_device_name(configured, &list_output_devices()?) {
        if let Some(device) = host
            .output_devices()?
            .find(|d| d.name().map(|n| n == name).unwrap_or(false))
        {
            return Ok(device);
        }
    }
    host.default_output_device()
        .ok_or_else(|| "No output device available".into())
}

pub fn list_input_devices() -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let host = cpal::default_host();
    let mut names = Vec::new();
    for device in host.input_devices()? {
        if let Ok(name) = device.name() {
            names.push(name);
        }
    }
    Ok(names)
}

pub fn list_output_devices() -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let host = cpal::default_host();
    let mut names = Vec::new();
    for device in host.output_devices()? {
        if let Ok(name) = device.name() {
            names.push(name);
        }
    }
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn devices() -> Vec<String> {
        vec![
            "Microphone (Realtek)".to_string(),
            "Headset (Jabra)".to_string(),
        ]
    }

    #[test]
    fn unset_device_falls_back_to_the_platform_default() {
        assert_eq!(resolve_device_name(None, &devices()), None);
        assert_eq!(resolve_device_name(Some(""), &devices()), None);
        assert_eq!(resolve_device_name(Some("default"), &devices()), None);
    }

    #[test]
    fn a_configured_device_that_is_present_is_used() {
        assert_eq!(
            resolve_device_name(Some("Headset (Jabra)"), &devices()),
            Some("Headset (Jabra)".to_string())
        );
    }

    #[test]
    fn an_unplugged_device_falls_back_instead_of_failing() {
        assert_eq!(resolve_device_name(Some("Webcam mic"), &devices()), None);
    }

    #[test]
    fn stereo_is_downmixed_to_mono() {
        // Two frames of [left, right] at the timeline rate: no resampling.
        let out = to_mono_16k(&[1.0, 0.0, 0.5, 0.5], 2, SAMPLE_RATE);
        assert_eq!(out, vec![0.5, 0.5]);
    }

    #[test]
    fn mono_at_the_timeline_rate_passes_through_untouched() {
        let out = to_mono_16k(&[0.1, -0.2, 0.3], 1, SAMPLE_RATE);
        assert_eq!(out, vec![0.1, -0.2, 0.3]);
    }

    #[test]
    fn downsampling_shortens_by_the_rate_ratio() {
        let input: Vec<f32> = (0..48).map(|i| i as f32 / 48.0).collect();
        let out = to_mono_16k(&input, 1, 48_000);
        assert_eq!(out.len(), 16);
        assert!(out[0].abs() < 1e-6);
    }

    /// End-to-end check that WASAPI loopback capture actually works on this
    /// machine: render a quiet tone on the default output and confirm the
    /// loopback stream picks it up. Needs real audio hardware, so it is opt-in:
    ///
    ///     cargo test --lib -- --ignored loopback
    #[test]
    #[ignore = "needs audio hardware; renders a quiet tone for a second"]
    fn loopback_capture_hears_what_the_machine_plays() {
        let mut recorder = AudioRecorder::new().expect("recorder");
        recorder
            .start(&CaptureConfig {
                mode: CaptureMode::MicPlusSystem,
                input_device: None,
                system_device: None,
            })
            .expect("capture starts");
        assert!(recorder.system_active(), "loopback stream must be open");

        let host = cpal::default_host();
        let device = host.default_output_device().expect("output device");
        let config = device.default_output_config().expect("output config");
        let rate = config.sample_rate().0 as f32;
        let channels = config.channels() as usize;
        let mut phase = 0.0f32;
        let tone = device
            .build_output_stream(
                &config.into(),
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    for frame in data.chunks_mut(channels) {
                        phase += 440.0 * std::f32::consts::TAU / rate;
                        let sample = 0.02 * phase.sin();
                        frame.iter_mut().for_each(|s| *s = sample);
                    }
                },
                |e| panic!("output stream error: {e}"),
                None,
            )
            .expect("tone stream");
        tone.play().expect("tone plays");

        std::thread::sleep(std::time::Duration::from_millis(1000));

        assert!(
            recorder.system_last_packet_ms_ago().is_some(),
            "no loopback packet arrived while audio was playing"
        );
        assert!(
            recorder.system_level() > 0.0,
            "loopback captured silence while a tone was playing"
        );

        drop(tone);
        let audio = recorder.stop().expect("stop");
        assert!(
            audio.iter().any(|s| s.abs() > 0.001),
            "mixed timeline is silent"
        );
    }
}
