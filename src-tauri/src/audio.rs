use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Audio buffer that is shared between threads.
/// The cpal::Stream is stored so it is dropped (and the mic released) on stop.
pub struct AudioRecorder {
    buffer: Arc<Mutex<Vec<f32>>>,
    /// Secondary buffer for dictation — only filled when dictation_active is true.
    dictation_buffer: Arc<Mutex<Vec<f32>>>,
    /// Flag: when true the cpal callback also writes to dictation_buffer.
    dictation_active: Arc<AtomicBool>,
    /// Current RMS audio level (0.0–1.0), updated by the recording callback.
    pub level: Arc<Mutex<f32>>,
    sample_rate: u32,
    stream: Option<cpal::Stream>,
}

// Safety: the other fields are Send+Sync. cpal::Stream is !Send on some
// platforms, but we never move it across threads — it stays in AudioRecorder
// which is behind Arc<Mutex<>> and only accessed from the main thread.
unsafe impl Send for AudioRecorder {}
unsafe impl Sync for AudioRecorder {}

impl AudioRecorder {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self {
            buffer: Arc::new(Mutex::new(Vec::new())),
            dictation_buffer: Arc::new(Mutex::new(Vec::new())),
            dictation_active: Arc::new(AtomicBool::new(false)),
            level: Arc::new(Mutex::new(0.0)),
            sample_rate: 16000,
            stream: None,
        })
    }

    pub fn start(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or("No input device available")?;

        // Use the device's default config instead of forcing 16kHz mono
        let default_config = device.default_input_config()?;
        let device_sample_rate = default_config.sample_rate().0;
        let device_channels = default_config.channels() as usize;

        log::info!(
            "Audio device: {} channels, {} Hz",
            device_channels,
            device_sample_rate
        );

        let config = cpal::StreamConfig {
            channels: device_channels as u16,
            sample_rate: cpal::SampleRate(device_sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        let buffer = self.buffer.clone();
        let dictation_buffer = self.dictation_buffer.clone();
        let dictation_active = self.dictation_active.clone();
        let level = self.level.clone();
        let target_rate = self.sample_rate;

        let stream = device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // Compute RMS level from raw input data
                if data.len() > 0 {
                    let sum_sq: f32 = data.iter().map(|s| s * s).sum();
                    let rms = (sum_sq / data.len() as f32).sqrt();
                    if let Ok(mut lvl) = level.lock() {
                        *lvl = rms.min(1.0);
                    }
                }

                // Mix to mono if needed, then resample to 16kHz
                let mono: Vec<f32> = if device_channels > 1 {
                    data.chunks(device_channels)
                        .map(|frame| frame.iter().sum::<f32>() / device_channels as f32)
                        .collect()
                } else {
                    data.to_vec()
                };

                let resampled = if device_sample_rate == target_rate {
                    mono
                } else {
                    let ratio = device_sample_rate as f64 / target_rate as f64;
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
                };

                // Write to main buffer
                if let Ok(mut buf) = buffer.lock() {
                    buf.extend_from_slice(&resampled);
                }

                // Write to dictation buffer if active
                if dictation_active.load(Ordering::Relaxed) {
                    if let Ok(mut dbuf) = dictation_buffer.lock() {
                        dbuf.extend_from_slice(&resampled);
                    }
                }
            },
            |err| {
                log::error!("Audio stream error: {}", err);
            },
            None,
        )?;

        stream.play()?;

        // Store the stream so it stays alive while recording
        self.stream = Some(stream);

        Ok(())
    }

    /// Stop recording entirely — drops the audio stream and returns the main buffer.
    pub fn stop(&mut self) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
        // Drop the stream to release the microphone
        self.stream.take();
        self.dictation_active.store(false, Ordering::Relaxed);

        let buffer = self.buffer.lock().map_err(|e| e.to_string())?;
        Ok(buffer.clone())
    }

    /// Take the main buffer contents and clear it (for meeting segment capture).
    pub fn take_buffer(&self) -> Vec<f32> {
        let mut buf = self.buffer.lock().unwrap();
        let data = buf.clone();
        buf.clear();
        data
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
    /// Used for incremental transcription: grab what we have so far, clear buffer,
    /// keep recording.
    pub fn take_dictation_chunk(&self) -> Vec<f32> {
        let mut buf = self.dictation_buffer.lock().unwrap();
        let data = buf.clone();
        buf.clear();
        data
    }
}

pub fn list_input_devices() -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let host = cpal::default_host();
    let devices = host.input_devices()?;

    let mut names = Vec::new();
    for device in devices {
        if let Ok(name) = device.name() {
            names.push(name);
        }
    }

    Ok(names)
}
