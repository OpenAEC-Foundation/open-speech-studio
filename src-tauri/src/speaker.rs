use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakerProfile {
    pub name: String,
    pub embedding: Vec<f32>,
    pub created_at: String,
}

pub struct SpeakerMatcher {
    model_path: PathBuf,
    profiles: Vec<SpeakerProfile>,
    threshold: f32,
    unknown_counter: u32,
    profiles_dir: PathBuf,
}

impl SpeakerMatcher {
    /// Create a new SpeakerMatcher. Validates that model_path exists (or will
    /// be downloaded later) and loads any existing profiles from profiles_dir.
    pub fn new(model_path: PathBuf, profiles_dir: PathBuf) -> Result<Self, String> {
        // Ensure profiles directory exists
        if !profiles_dir.exists() {
            fs::create_dir_all(&profiles_dir)
                .map_err(|e| format!("Failed to create profiles dir: {e}"))?;
        }

        let profiles = Self::load_profiles(&profiles_dir)?;

        Ok(Self {
            model_path,
            profiles,
            threshold: 0.75,
            unknown_counter: 0,
            profiles_dir,
        })
    }

    /// Load all speaker profiles from JSON files in the given directory.
    fn load_profiles(dir: &Path) -> Result<Vec<SpeakerProfile>, String> {
        let mut profiles = Vec::new();

        if !dir.exists() {
            return Ok(profiles);
        }

        let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read profiles dir: {e}"))?;

        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read dir entry: {e}"))?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                let data =
                    fs::read_to_string(&path).map_err(|e| format!("Failed to read {path:?}: {e}"))?;
                match serde_json::from_str::<SpeakerProfile>(&data) {
                    Ok(profile) => profiles.push(profile),
                    Err(e) => {
                        log::warn!("Skipping invalid profile {path:?}: {e}");
                    }
                }
            }
        }

        Ok(profiles)
    }

    /// Extract a speaker embedding from raw audio samples using the ONNX model.
    ///
    /// The model is expected to be an ECAPA-TDNN or similar speaker verification
    /// model that takes a 1-D audio waveform and outputs an embedding vector.
    pub fn extract_embedding(&self, audio: &[f32]) -> Result<Vec<f32>, String> {
        if !self.model_path.exists() {
            return Err(format!(
                "Speaker embedding model not found at {:?}. Download it via the Model Manager.",
                self.model_path
            ));
        }

        let mut session = ort::session::Session::builder()
            .map_err(|e| format!("Failed to create ONNX session builder: {e}"))?
            .commit_from_file(&self.model_path)
            .map_err(|e| format!("Failed to load ONNX model: {e}"))?;

        // Create input tensor with shape [1, num_samples]
        let input = ort::value::Value::from_array(
            ndarray::Array2::from_shape_vec((1, audio.len()), audio.to_vec())
                .map_err(|e| format!("Failed to create input array: {e}"))?,
        )
        .map_err(|e| format!("Failed to create input tensor: {e}"))?;

        let outputs = session
            .run(ort::inputs![input])
            .map_err(|e| format!("ONNX inference failed: {e}"))?;

        // Extract the embedding from the first output
        let binding = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Failed to extract output tensor: {e}"))?;
        let embedding: Vec<f32> = binding.1.iter().copied().collect();

        Ok(embedding)
    }

    /// Compute cosine similarity between two embedding vectors.
    fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() || a.is_empty() {
            return 0.0;
        }

        let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

        if norm_a == 0.0 || norm_b == 0.0 {
            return 0.0;
        }

        dot / (norm_a * norm_b)
    }

    /// Identify the speaker from an audio segment. Returns (name, confidence).
    /// If no profile matches above the threshold, assigns "Onbekend N".
    pub fn identify_speaker(&mut self, audio: &[f32]) -> Result<(String, f32), String> {
        let embedding = self.extract_embedding(audio)?;

        let mut best_name = String::new();
        let mut best_score: f32 = 0.0;

        for profile in &self.profiles {
            let score = Self::cosine_similarity(&embedding, &profile.embedding);
            if score > best_score {
                best_score = score;
                best_name = profile.name.clone();
            }
        }

        if best_score >= self.threshold {
            Ok((best_name, best_score))
        } else {
            self.unknown_counter += 1;
            Ok((format!("Onbekend {}", self.unknown_counter), best_score))
        }
    }

    /// Train a new speaker profile from audio samples and persist it to disk.
    pub fn train_profile(&mut self, name: &str, audio: &[f32]) -> Result<(), String> {
        let embedding = self.extract_embedding(audio)?;

        let profile = SpeakerProfile {
            name: name.to_string(),
            embedding,
            created_at: chrono::Utc::now().to_rfc3339(),
        };

        // Save to disk
        let filename = format!("{}.json", sanitize_filename(name));
        let path = self.profiles_dir.join(&filename);
        let json = serde_json::to_string_pretty(&profile)
            .map_err(|e| format!("Failed to serialize profile: {e}"))?;
        fs::write(&path, json).map_err(|e| format!("Failed to write profile to {path:?}: {e}"))?;

        // Update in-memory list (replace if exists)
        self.profiles.retain(|p| p.name != name);
        self.profiles.push(profile);

        Ok(())
    }

    /// Return the names of all known speaker profiles.
    pub fn list_profiles(&self) -> Vec<String> {
        self.profiles.iter().map(|p| p.name.clone()).collect()
    }

    /// Delete a speaker profile by name (from memory and disk).
    pub fn delete_profile(&mut self, name: &str) -> Result<(), String> {
        self.profiles.retain(|p| p.name != name);

        let filename = format!("{}.json", sanitize_filename(name));
        let path = self.profiles_dir.join(&filename);
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete profile file {path:?}: {e}"))?;
        }

        Ok(())
    }

    /// Reset the unknown speaker counter (e.g. at the start of a new meeting).
    pub fn reset_unknown_counter(&mut self) {
        self.unknown_counter = 0;
    }
}

/// Sanitize a string for use as a filename (remove/replace problematic chars).
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}
