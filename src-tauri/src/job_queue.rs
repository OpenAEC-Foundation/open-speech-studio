use std::time::Instant;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq)]
pub enum JobType {
    Dictation,
    MeetingSegment,
}

#[derive(Debug, Clone, PartialEq)]
pub enum JobStatus {
    Queued,
    Processing,
    Done,
    Failed,
}

#[derive(Debug, Clone)]
pub struct TranscriptionJob {
    pub id: Uuid,
    pub audio: Vec<f32>,
    pub target_hwnd: usize,
    pub language: String,
    pub job_type: JobType,
    pub chunk_index: Option<u32>,
    pub session_id: Uuid,
    pub created_at: Instant,
    pub status: JobStatus,
}

#[derive(Debug, Clone)]
pub struct JobResult {
    pub job_id: Uuid,
    pub session_id: Uuid,
    pub chunk_index: Option<u32>,
    pub text: String,
    pub speaker: Option<String>,
    pub duration_ms: u64,
    pub progress_pct: u8,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SessionStatus {
    Recording,
    Transcribing,
    Done,
    Failed,
}

#[derive(Debug)]
pub struct DictationSession {
    pub id: Uuid,
    pub target_hwnd: usize,
    pub language: String,
    pub chunks: Vec<Option<String>>,
    pub total_chunks: u32,
    pub status: SessionStatus,
    pub created_at: Instant,
}

impl DictationSession {
    pub fn new(target_hwnd: usize, language: String) -> Self {
        Self {
            id: Uuid::new_v4(),
            target_hwnd,
            language,
            chunks: Vec::new(),
            total_chunks: 0,
            status: SessionStatus::Recording,
            created_at: Instant::now(),
        }
    }

    pub fn is_complete(&self) -> bool {
        self.total_chunks > 0
            && self.chunks.len() == self.total_chunks as usize
            && self.chunks.iter().all(|c| c.is_some())
    }

    pub fn assembled_text(&self) -> String {
        self.chunks
            .iter()
            .filter_map(|c| c.as_deref())
            .collect::<Vec<_>>()
            .join(" ")
    }
}
