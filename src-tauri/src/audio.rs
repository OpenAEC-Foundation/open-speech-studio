use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};

/// Audio buffer that is shared between threads.
/// The cpal::Stream is NOT stored in the struct (it's not Send+Sync).
/// Instead we keep it alive via a separate mechanism.
pub struct AudioRecorder {
    buffer: Arc<Mutex<Vec<f32>>>,
    /// Current RMS audio level (0.0–1.0), updated by the recording callback.
    pub level: Arc<Mutex<f32>>,
    sample_rate: u32,
}

// Safety: AudioRecorder only contains Arc<Mutex<Vec<f32>>> and u32,
// both of which are Send+Sync. We don't store the cpal::Stream.
unsafe impl Send for AudioRecorder {}
unsafe impl Sync for AudioRecorder {}

impl AudioRecorder {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self {
            buffer: Arc::new(Mutex::new(Vec::new())),
            level: Arc::new(Mutex::new(0.0)),
            sample_rate: 16000,
        })
    }

    pub fn start(&self) -> Result<(), Box<dyn std::error::Error>> {
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

                if let Ok(mut buf) = buffer.lock() {
                    // Mix to mono if needed, then resample to 16kHz
                    let mono: Vec<f32> = if device_channels > 1 {
                        data.chunks(device_channels)
                            .map(|frame| frame.iter().sum::<f32>() / device_channels as f32)
                            .collect()
                    } else {
                        data.to_vec()
                    };

                    if device_sample_rate == target_rate {
                        buf.extend_from_slice(&mono);
                    } else {
                        // Simple linear resampling
                        let ratio = device_sample_rate as f64 / target_rate as f64;
                        let out_len = (mono.len() as f64 / ratio) as usize;
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
                            buf.push(sample);
                        }
                    }
                }
            },
            |err| {
                log::error!("Audio stream error: {}", err);
            },
            None,
        )?;

        stream.play()?;

        // Keep the stream alive by leaking it.
        std::mem::forget(stream);

        Ok(())
    }

    pub fn stop(self) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
        let buffer = self.buffer.lock().map_err(|e| e.to_string())?;
        Ok(buffer.clone())
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
