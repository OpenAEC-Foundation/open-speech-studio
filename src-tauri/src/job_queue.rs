use crate::transcriber::Transcriber;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::thread;
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

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
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

#[derive(Debug, Clone, serde::Serialize)]
pub struct QueueStatus {
    pub queued: usize,
    pub active: usize,
    pub completed: usize,
    pub sessions: Vec<SessionInfo>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub status: SessionStatus,
    pub completed_chunks: u32,
    pub total_chunks: u32,
    pub current_progress_pct: u8,
}

pub struct JobQueue {
    queue: Arc<Mutex<VecDeque<TranscriptionJob>>>,
    active: Arc<Mutex<HashMap<Uuid, Uuid>>>,
    results: Arc<Mutex<Vec<JobResult>>>,
    sessions: Arc<Mutex<HashMap<Uuid, DictationSession>>>,
    max_workers: usize,
    active_worker_count: Arc<Mutex<usize>>,
    transcriber: Arc<Mutex<Option<Transcriber>>>,
}

impl JobQueue {
    pub fn new(max_workers: usize, transcriber: Option<Transcriber>) -> Self {
        Self {
            queue: Arc::new(Mutex::new(VecDeque::new())),
            active: Arc::new(Mutex::new(HashMap::new())),
            results: Arc::new(Mutex::new(Vec::new())),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            max_workers: max_workers.clamp(1, 3),
            active_worker_count: Arc::new(Mutex::new(0)),
            transcriber: Arc::new(Mutex::new(transcriber)),
        }
    }

    pub fn set_max_workers(&mut self, max: usize) {
        self.max_workers = max.clamp(1, 3);
    }

    pub fn create_session(&self, target_hwnd: usize, language: String) -> Uuid {
        let session = DictationSession::new(target_hwnd, language);
        let id = session.id;
        self.sessions.lock().unwrap().insert(id, session);
        id
    }

    pub fn submit(&self, job: TranscriptionJob) -> Uuid {
        let job_id = job.id;
        let session_id = job.session_id;

        // Grow session chunks vector if needed
        if let Some(chunk_index) = job.chunk_index {
            let mut sessions = self.sessions.lock().unwrap();
            if let Some(session) = sessions.get_mut(&session_id) {
                let idx = chunk_index as usize;
                if session.chunks.len() <= idx {
                    session.chunks.resize(idx + 1, None);
                }
                if session.status == SessionStatus::Recording {
                    session.status = SessionStatus::Transcribing;
                }
            }
        }

        self.queue.lock().unwrap().push_back(job);
        self.try_dispatch_workers();
        job_id
    }

    pub fn finalize_session_chunks(&self, session_id: Uuid, total: u32) {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(&session_id) {
            session.total_chunks = total;
            // Ensure chunks vector is the right size
            if session.chunks.len() < total as usize {
                session.chunks.resize(total as usize, None);
            }
        }
    }

    fn try_dispatch_workers(&self) {
        loop {
            let current_workers = *self.active_worker_count.lock().unwrap();
            if current_workers >= self.max_workers {
                break;
            }

            let job = self.queue.lock().unwrap().pop_front();
            let job = match job {
                Some(j) => j,
                None => break,
            };

            let job_id = job.id;
            let session_id = job.session_id;
            self.active.lock().unwrap().insert(job_id, session_id);
            *self.active_worker_count.lock().unwrap() += 1;

            let transcriber_ref = Arc::clone(&self.transcriber);
            let results_ref = Arc::clone(&self.results);
            let sessions_ref = Arc::clone(&self.sessions);
            let active_ref = Arc::clone(&self.active);
            let worker_count_ref = Arc::clone(&self.active_worker_count);
            let queue_ref = Arc::clone(&self.queue);

            thread::spawn(move || {
                let start = Instant::now();
                let transcriber = {
                    let guard = transcriber_ref.lock().unwrap();
                    guard.clone()
                };
                let result_text = match transcriber {
                    Some(t) => match t.transcribe(&job.audio, &job.language) {
                        Ok(text) => text,
                        Err(e) => {
                            log::error!("Transcription failed for job {}: {}", job_id, e);
                            String::new()
                        }
                    },
                    None => {
                        log::warn!("No transcriber available for job {}", job_id);
                        String::new()
                    }
                };
                let duration_ms = start.elapsed().as_millis() as u64;

                // Update session with result
                {
                    let mut sessions = sessions_ref.lock().unwrap();
                    if let Some(session) = sessions.get_mut(&session_id) {
                        if let Some(chunk_index) = job.chunk_index {
                            let idx = chunk_index as usize;
                            if idx < session.chunks.len() {
                                session.chunks[idx] = Some(result_text.clone());
                            }
                        }
                        // Check if session is now complete
                        if session.is_complete() {
                            session.status = SessionStatus::Done;
                        }
                    }
                }

                // Compute progress percentage
                let progress_pct = {
                    let sessions = sessions_ref.lock().unwrap();
                    if let Some(session) = sessions.get(&session_id) {
                        if session.total_chunks > 0 {
                            let completed = session.chunks.iter().filter(|c| c.is_some()).count() as u32;
                            ((completed * 100) / session.total_chunks) as u8
                        } else {
                            0
                        }
                    } else {
                        0
                    }
                };

                // Store result
                results_ref.lock().unwrap().push(JobResult {
                    job_id,
                    session_id,
                    chunk_index: job.chunk_index,
                    text: result_text,
                    speaker: None,
                    duration_ms,
                    progress_pct,
                });

                // Remove from active
                active_ref.lock().unwrap().remove(&job_id);

                // Decrement worker count
                *worker_count_ref.lock().unwrap() -= 1;

                // Try to pick up next queued job
                if let Some(next_job) = queue_ref.lock().unwrap().pop_front() {
                    let next_job_id = next_job.id;
                    let next_session_id = next_job.session_id;
                    active_ref.lock().unwrap().insert(next_job_id, next_session_id);
                    *worker_count_ref.lock().unwrap() += 1;

                    // Recursive inline — spawn another worker for the next job
                    let start = Instant::now();
                    let transcriber = {
                        let guard = transcriber_ref.lock().unwrap();
                        guard.clone()
                    };
                    let result_text = match transcriber {
                        Some(t) => match t.transcribe(&next_job.audio, &next_job.language) {
                            Ok(text) => text,
                            Err(e) => {
                                log::error!("Transcription failed for job {}: {}", next_job_id, e);
                                String::new()
                            }
                        },
                        None => String::new(),
                    };
                    let duration_ms = start.elapsed().as_millis() as u64;

                    {
                        let mut sessions = sessions_ref.lock().unwrap();
                        if let Some(session) = sessions.get_mut(&next_session_id) {
                            if let Some(chunk_index) = next_job.chunk_index {
                                let idx = chunk_index as usize;
                                if idx < session.chunks.len() {
                                    session.chunks[idx] = Some(result_text.clone());
                                }
                            }
                            if session.is_complete() {
                                session.status = SessionStatus::Done;
                            }
                        }
                    }

                    let progress_pct = {
                        let sessions = sessions_ref.lock().unwrap();
                        if let Some(session) = sessions.get(&next_session_id) {
                            if session.total_chunks > 0 {
                                let completed = session.chunks.iter().filter(|c| c.is_some()).count() as u32;
                                ((completed * 100) / session.total_chunks) as u8
                            } else {
                                0
                            }
                        } else {
                            0
                        }
                    };

                    results_ref.lock().unwrap().push(JobResult {
                        job_id: next_job_id,
                        session_id: next_session_id,
                        chunk_index: next_job.chunk_index,
                        text: result_text,
                        speaker: None,
                        duration_ms,
                        progress_pct,
                    });

                    active_ref.lock().unwrap().remove(&next_job_id);
                    *worker_count_ref.lock().unwrap() -= 1;
                }
            });
        }
    }

    pub fn poll_results(&self) -> Vec<JobResult> {
        let mut results = self.results.lock().unwrap();
        results.drain(..).collect()
    }

    pub fn get_completed_sessions(&self) -> Vec<(Uuid, usize, String)> {
        let mut sessions = self.sessions.lock().unwrap();
        let done_ids: Vec<Uuid> = sessions
            .iter()
            .filter(|(_, s)| s.status == SessionStatus::Done)
            .map(|(id, _)| *id)
            .collect();

        let mut completed = Vec::new();
        for id in done_ids {
            if let Some(session) = sessions.remove(&id) {
                completed.push((id, session.target_hwnd, session.assembled_text()));
            }
        }
        completed
    }

    pub fn get_status(&self) -> QueueStatus {
        let queued = self.queue.lock().unwrap().len();
        let active = self.active.lock().unwrap().len();
        let completed = self.results.lock().unwrap().len();

        let sessions = self.sessions.lock().unwrap();
        let session_infos: Vec<SessionInfo> = sessions
            .iter()
            .map(|(id, s)| {
                let completed_chunks = s.chunks.iter().filter(|c| c.is_some()).count() as u32;
                let progress_pct = if s.total_chunks > 0 {
                    ((completed_chunks * 100) / s.total_chunks) as u8
                } else {
                    0
                };
                SessionInfo {
                    session_id: id.to_string(),
                    status: s.status.clone(),
                    completed_chunks,
                    total_chunks: s.total_chunks,
                    current_progress_pct: progress_pct,
                }
            })
            .collect();

        QueueStatus {
            queued,
            active,
            completed,
            sessions: session_infos,
        }
    }
}
