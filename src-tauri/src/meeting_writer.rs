use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use chrono::Local;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingSegment {
    pub timestamp: String,
    pub speaker: String,
    pub speaker_confidence: f32,
    pub text: String,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingMetadata {
    pub meeting_id: String,
    pub started_at: String,
    pub segments: Vec<MeetingSegment>,
}

pub struct MeetingWriter {
    md_path: PathBuf,
    json_path: PathBuf,
    metadata: MeetingMetadata,
}

impl MeetingWriter {
    pub fn new(save_dir: &str, meeting_id: &str) -> Result<Self, String> {
        let save_dir = PathBuf::from(save_dir);
        fs::create_dir_all(&save_dir).map_err(|e| format!("Failed to create meeting dir: {}", e))?;

        let now = Local::now();
        let filename = now.format("%Y-%m-%d_meeting_%H-%M").to_string();
        let md_path = save_dir.join(format!("{}.md", filename));
        let json_path = save_dir.join(format!("{}.json", filename));

        // Write markdown header
        let header = format!("# Meeting — {}\n\n", now.format("%Y-%m-%d %H:%M"));
        fs::write(&md_path, &header).map_err(|e| format!("Failed to write md: {}", e))?;

        let metadata = MeetingMetadata {
            meeting_id: meeting_id.to_string(),
            started_at: now.to_rfc3339(),
            segments: Vec::new(),
        };

        // Write initial JSON
        let json = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
        fs::write(&json_path, &json).map_err(|e| format!("Failed to write json: {}", e))?;

        Ok(Self { md_path, json_path, metadata })
    }

    pub fn append_segment(
        &mut self,
        speaker: &str,
        speaker_confidence: f32,
        text: &str,
        duration_ms: u64,
    ) -> Result<(), String> {
        let timestamp = Local::now().format("%H:%M:%S").to_string();

        // Append to markdown with fsync
        let line = format!("[{}] {}: {}\n", timestamp, speaker, text);
        let mut md_file = OpenOptions::new()
            .append(true)
            .open(&self.md_path)
            .map_err(|e| format!("Failed to open md: {}", e))?;
        md_file.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        md_file.sync_all().map_err(|e| format!("Failed to sync md: {}", e))?;

        // Update JSON metadata with fsync
        let segment = MeetingSegment {
            timestamp, speaker: speaker.to_string(), speaker_confidence,
            text: text.to_string(), duration_ms,
        };
        self.metadata.segments.push(segment);

        let json = serde_json::to_string_pretty(&self.metadata).map_err(|e| e.to_string())?;
        let mut json_file = OpenOptions::new()
            .write(true).truncate(true)
            .open(&self.json_path)
            .map_err(|e| format!("Failed to open json: {}", e))?;
        json_file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        json_file.sync_all().map_err(|e| format!("Failed to sync json: {}", e))?;

        Ok(())
    }

    pub fn get_md_path(&self) -> &Path { &self.md_path }
    pub fn get_json_path(&self) -> &Path { &self.json_path }
    pub fn segment_count(&self) -> usize { self.metadata.segments.len() }
}
