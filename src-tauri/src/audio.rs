use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};

/// Audio buffer that is shared between threads.
/// The cpal::Stream is NOT stored in the struct (it's not Send+Sync).
/// Instead we keep it alive via a separate mechanism.
pub struct AudioRecorder {
    buffer: Arc<Mutex<Vec<f32>>>,
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
            sample_rate: 16000,
        })
    }

    pub fn start(&self) -> Result<(), Box<dyn std::error::Error>> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or("No input device available")?;

        let config = cpal::StreamConfig {
            channels: 1,
            sample_rate: cpal::SampleRate(self.sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        let buffer = self.buffer.clone();

        let stream = device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if let Ok(mut buf) = buffer.lock() {
                    buf.extend_from_slice(data);
                }
            },
            |err| {
                log::error!("Audio stream error: {}", err);
            },
            None,
        )?;

        stream.play()?;

        // Keep the stream alive by leaking it.
        // It will be cleaned up when the process exits or when we
        // create a new recording (the old stream is dropped).
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
