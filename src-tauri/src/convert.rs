//! Native audio file conversion using symphonia (decode) + hound (WAV write).
//!
//! Converts any supported audio format (mp3, m4a/aac, flac, wav) to
//! 16 kHz mono PCM 16-bit WAV — the format whisper.cpp expects.

use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

const TARGET_RATE: u32 = 16_000;

/// Decode an audio file and write a 16 kHz mono WAV to `output_path`.
pub fn to_wav_16k_mono(input_path: &str, output_path: &str) -> Result<(), String> {
    let path = Path::new(input_path);
    let file = std::fs::File::open(path)
        .map_err(|e| format!("Cannot open {}: {}", input_path, e))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("Unsupported audio format: {}", e))?;

    let mut format = probed.format;

    // Pick the first audio track
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or("No audio track found")?;

    let codec_params = track.codec_params.clone();
    let track_id = track.id;
    let source_rate = codec_params.sample_rate.unwrap_or(44100);
    let _source_channels = codec_params.channels.map(|c| c.count()).unwrap_or(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Unsupported codec: {}", e))?;

    // Collect all samples as f32 mono
    let mut mono_samples: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue,
        };

        let spec = *decoded.spec();
        let num_frames = decoded.capacity();
        let channels = spec.channels.count();

        let mut sample_buf = SampleBuffer::<f32>::new(num_frames as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);
        let samples = sample_buf.samples();

        // Mix to mono
        if channels > 1 {
            for frame in samples.chunks(channels) {
                let sum: f32 = frame.iter().sum();
                mono_samples.push(sum / channels as f32);
            }
        } else {
            mono_samples.extend_from_slice(samples);
        }
    }

    if mono_samples.is_empty() {
        return Err("No audio data decoded".to_string());
    }

    // Resample to 16 kHz if needed
    let resampled = if source_rate == TARGET_RATE {
        mono_samples
    } else {
        resample(&mono_samples, source_rate, TARGET_RATE)
    };

    // Write WAV via hound
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(output_path, spec)
        .map_err(|e| format!("Cannot create WAV file: {}", e))?;

    for &s in &resampled {
        let clamped = s.clamp(-1.0, 1.0);
        let i16_val = (clamped * 32767.0) as i16;
        writer.write_sample(i16_val).map_err(|e| format!("WAV write error: {}", e))?;
    }
    writer.finalize().map_err(|e| format!("WAV finalize error: {}", e))?;

    Ok(())
}

/// Linear interpolation resampling.
fn resample(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = (input.len() as f64 / ratio) as usize;
    let mut output = Vec::with_capacity(out_len);

    for i in 0..out_len {
        let src_idx = i as f64 * ratio;
        let idx = src_idx as usize;
        let frac = (src_idx - idx as f64) as f32;

        let sample = if idx + 1 < input.len() {
            input[idx] * (1.0 - frac) + input[idx + 1] * frac
        } else if idx < input.len() {
            input[idx]
        } else {
            0.0
        };
        output.push(sample);
    }

    output
}
