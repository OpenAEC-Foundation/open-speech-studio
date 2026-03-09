use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct Transcriber {
    ctx: WhisperContext,
}

impl Transcriber {
    pub fn new(model_path: &str, use_gpu: bool) -> Result<Self, Box<dyn std::error::Error>> {
        let mut params = WhisperContextParameters::default();
        params.use_gpu(use_gpu);

        let ctx = WhisperContext::new_with_params(model_path, params)?;

        Ok(Self { ctx })
    }

    pub fn transcribe(
        &self,
        audio_data: &[f32],
        language: &str,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

        // Set language (empty string = auto-detect)
        if !language.is_empty() && language != "auto" {
            params.set_language(Some(language));
        } else {
            params.set_language(None);
        }

        // Optimize for dictation use case
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_translate(false);
        params.set_no_context(true);
        params.set_single_segment(true);
        params.set_suppress_blank(true);
        params.set_suppress_non_speech_tokens(true);

        // Use 4 threads for CPU inference
        params.set_n_threads(4);

        let mut state = self.ctx.create_state()?;
        state.full(params, audio_data)?;

        let num_segments = state.full_n_segments()?;
        let mut result = String::new();

        for i in 0..num_segments {
            if let Ok(segment) = state.full_get_segment_text(i) {
                result.push_str(&segment);
            }
        }

        Ok(result.trim().to_string())
    }
}
