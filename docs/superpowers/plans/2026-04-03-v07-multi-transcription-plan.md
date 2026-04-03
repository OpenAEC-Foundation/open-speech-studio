# Open Speech Studio v0.7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add parallel multi-cursor transcription, incremental chunked processing, meeting enhancements with speaker diarization, local LLM auto-correction, retro game sounds with preference learning, and UI improvements.

**Architecture:** A central job queue with a configurable worker pool replaces the current single-transcriber model. Each dictation or meeting chunk becomes a job routed to the queue. New subsystems (speaker diarization via ONNX, auto-correction via llama.cpp, retro sounds) integrate as post-processing steps or independent modules.

**Tech Stack:** Rust/Tauri 2 backend, SolidJS frontend, whisper.cpp (existing), ONNX Runtime (`ort` crate) for speaker embeddings, llama.cpp for auto-correction, cpal for audio.

---

## Phase 1: Core Infrastructure

> Job queue, worker pool, incremental recording, progress, and settings foundation. Everything else builds on this.

---

### Task 1: New Settings Fields (Backend)

**Files:**
- Modify: `src-tauri/src/settings.rs`

- [ ] **Step 1: Add new fields to Settings struct**

In `src-tauri/src/settings.rs`, add the new fields after the existing `audio_feedback` field (line ~22):

```rust
// After existing fields in the Settings struct:

    // Transcription
    pub incremental_interval_secs: f32,
    pub max_workers: usize,
    pub auto_correct: bool,
    pub auto_correct_model: String,

    // Meeting
    pub meeting_save_dir: String,
    pub speaker_diarization: bool,
    pub floating_indicator: bool,

    // Sounds
    pub sound_pack: String,
    pub sound_volume: f32,
```

- [ ] **Step 2: Add defaults in Default implementation**

In the `Default` impl or `load_settings` fallback (around line 31-52), add:

```rust
    incremental_interval_secs: 5.0,
    max_workers: 2,
    auto_correct: false,
    auto_correct_model: String::new(),
    meeting_save_dir: dirs::document_dir()
        .unwrap_or_default()
        .join("OSS Meetings")
        .to_string_lossy()
        .to_string(),
    speaker_diarization: false,
    floating_indicator: true,
    sound_pack: "retro".to_string(),
    sound_volume: 0.7,
```

- [ ] **Step 3: Build and verify**

Run: `cd src-tauri && cargo build 2>&1 | head -30`
Expected: Build succeeds. Existing settings.json files will gain new fields with defaults on next load (serde default).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/settings.rs
git commit -m "feat: add settings fields for v0.7 features (incremental, workers, meeting, sounds)"
```

---

### Task 2: TranscriptionJob and JobResult Types

**Files:**
- Create: `src-tauri/src/job_queue.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod job_queue;`)

- [ ] **Step 1: Create job_queue.rs with core types**

Create `src-tauri/src/job_queue.rs`:

```rust
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
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
```

- [ ] **Step 2: Add uuid dependency to Cargo.toml**

In `src-tauri/Cargo.toml` under `[dependencies]`, add:

```toml
uuid = { version = "1", features = ["v4"] }
```

- [ ] **Step 3: Register module in lib.rs**

At the top of `src-tauri/src/lib.rs`, with the other `mod` declarations, add:

```rust
mod job_queue;
```

- [ ] **Step 4: Build and verify**

Run: `cd src-tauri && cargo build 2>&1 | head -30`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/job_queue.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat: add TranscriptionJob, JobResult, and DictationSession types"
```

---

### Task 3: Job Queue with Worker Pool

**Files:**
- Modify: `src-tauri/src/job_queue.rs`
- Modify: `src-tauri/src/transcriber.rs`

- [ ] **Step 1: Add worker pool to job_queue.rs**

Append to `src-tauri/src/job_queue.rs`:

```rust
use crate::transcriber::Transcriber;
use std::sync::mpsc;
use std::thread;

#[derive(Debug, Clone)]
pub struct QueueStatus {
    pub queued: usize,
    pub active: usize,
    pub completed: usize,
    pub sessions: Vec<SessionInfo>,
}

#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub session_id: Uuid,
    pub status: SessionStatus,
    pub completed_chunks: u32,
    pub total_chunks: u32,
    pub current_progress_pct: u8,
}

pub struct JobQueue {
    queue: Arc<Mutex<VecDeque<TranscriptionJob>>>,
    active: Arc<Mutex<HashMap<Uuid, Uuid>>>,  // job_id -> worker thread id
    results: Arc<Mutex<Vec<JobResult>>>,
    sessions: Arc<Mutex<HashMap<Uuid, DictationSession>>>,
    max_workers: usize,
    active_worker_count: Arc<Mutex<usize>>,
    transcriber: Arc<Mutex<Option<Transcriber>>>,
    progress_sender: Option<mpsc::Sender<(Uuid, Uuid, u8)>>,  // job_id, session_id, pct
}

impl JobQueue {
    pub fn new(
        max_workers: usize,
        transcriber: Arc<Mutex<Option<Transcriber>>>,
    ) -> Self {
        Self {
            queue: Arc::new(Mutex::new(VecDeque::new())),
            active: Arc::new(Mutex::new(HashMap::new())),
            results: Arc::new(Mutex::new(Vec::new())),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            max_workers,
            active_worker_count: Arc::new(Mutex::new(0)),
            transcriber,
            progress_sender: None,
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

    pub fn submit(&self, mut job: TranscriptionJob) -> Uuid {
        let id = job.id;
        job.status = JobStatus::Queued;

        // Update session chunk count
        if let Some(chunk_idx) = job.chunk_index {
            if let Some(session) = self.sessions.lock().unwrap().get_mut(&job.session_id) {
                let needed = (chunk_idx + 1) as usize;
                if session.chunks.len() < needed {
                    session.chunks.resize(needed, None);
                }
                session.total_chunks = session.total_chunks.max(chunk_idx + 1);
                session.status = SessionStatus::Transcribing;
            }
        }

        self.queue.lock().unwrap().push_back(job);
        self.try_dispatch_workers();
        id
    }

    pub fn finalize_session_chunks(&self, session_id: Uuid, total: u32) {
        if let Some(session) = self.sessions.lock().unwrap().get_mut(&session_id) {
            session.total_chunks = total;
            session.chunks.resize(total as usize, None);
        }
    }

    fn try_dispatch_workers(&self) {
        let mut worker_count = self.active_worker_count.lock().unwrap();
        while *worker_count < self.max_workers {
            let job = {
                let mut q = self.queue.lock().unwrap();
                q.pop_front()
            };
            let Some(mut job) = job else { break };

            job.status = JobStatus::Processing;
            let job_id = job.id;
            let session_id = job.session_id;
            let chunk_index = job.chunk_index;

            self.active.lock().unwrap().insert(job_id, Uuid::new_v4());
            *worker_count += 1;

            let queue_ref = self.queue.clone();
            let active_ref = self.active.clone();
            let results_ref = self.results.clone();
            let sessions_ref = self.sessions.clone();
            let worker_count_ref = self.active_worker_count.clone();
            let transcriber_ref = self.transcriber.clone();
            let max_workers = self.max_workers;

            thread::spawn(move || {
                let start = Instant::now();

                // Clone transcriber to release the lock
                let transcriber = {
                    let guard = transcriber_ref.lock().unwrap();
                    guard.clone()
                };

                let result_text = match transcriber {
                    Some(t) => t.transcribe(&job.audio, &job.language).unwrap_or_default(),
                    None => String::new(),
                };

                let duration_ms = start.elapsed().as_millis() as u64;

                let result = JobResult {
                    job_id: job.id,
                    session_id,
                    chunk_index,
                    text: result_text.clone(),
                    speaker: None,
                    duration_ms,
                    progress_pct: 100,
                };

                results_ref.lock().unwrap().push(result);
                active_ref.lock().unwrap().remove(&job_id);

                // Update session with chunk result
                if let Some(idx) = chunk_index {
                    let mut sessions = sessions_ref.lock().unwrap();
                    if let Some(session) = sessions.get_mut(&session_id) {
                        let idx = idx as usize;
                        if idx < session.chunks.len() {
                            session.chunks[idx] = Some(result_text);
                        }
                        if session.is_complete() {
                            session.status = SessionStatus::Done;
                        }
                    }
                }

                // Decrement worker count and try to dispatch more
                {
                    let mut count = worker_count_ref.lock().unwrap();
                    *count -= 1;
                }

                // Try to pick up next job
                let next_job = {
                    let mut q = queue_ref.lock().unwrap();
                    q.pop_front()
                };
                if let Some(mut next) = next_job {
                    next.status = JobStatus::Processing;
                    // Would need to recurse or re-dispatch here
                    // For now, the main submit() path handles dispatch
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
        let mut completed = Vec::new();

        let done_ids: Vec<Uuid> = sessions
            .iter()
            .filter(|(_, s)| s.status == SessionStatus::Done)
            .map(|(id, _)| *id)
            .collect();

        for id in done_ids {
            if let Some(session) = sessions.remove(&id) {
                completed.push((session.id, session.target_hwnd, session.assembled_text()));
            }
        }

        completed
    }

    pub fn get_status(&self) -> QueueStatus {
        let queued = self.queue.lock().unwrap().len();
        let active = self.active.lock().unwrap().len();
        let completed = self.results.lock().unwrap().len();

        let sessions: Vec<SessionInfo> = self.sessions.lock().unwrap()
            .iter()
            .map(|(_, s)| SessionInfo {
                session_id: s.id,
                status: s.status.clone(),
                completed_chunks: s.chunks.iter().filter(|c| c.is_some()).count() as u32,
                total_chunks: s.total_chunks,
                current_progress_pct: 0,
            })
            .collect();

        QueueStatus { queued, active, completed, sessions }
    }
}
```

- [ ] **Step 2: Make Transcriber cloneable**

In `src-tauri/src/transcriber.rs`, add `Clone` derive to the Transcriber struct (line ~7):

```rust
#[derive(Clone)]
pub struct Transcriber {
    whisper_bin: PathBuf,
    model_path: PathBuf,
    use_gpu: bool,
}
```

- [ ] **Step 3: Build and verify**

Run: `cd src-tauri && cargo build 2>&1 | head -30`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/job_queue.rs src-tauri/src/transcriber.rs
git commit -m "feat: implement JobQueue with worker pool for parallel transcription"
```

---

### Task 4: Integrate Job Queue into AppState

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add JobQueue to AppState**

In `src-tauri/src/lib.rs`, update the AppState struct (around line 48) to add:

```rust
use crate::job_queue::{JobQueue, TranscriptionJob, JobType, JobStatus, DictationSession};
use uuid::Uuid;

// Add to AppState struct:
    job_queue: Arc<Mutex<Option<JobQueue>>>,
    sessions: Arc<Mutex<HashMap<Uuid, ()>>>,  // track active session IDs
```

Initialize in the builder (where AppState is constructed):

```rust
    job_queue: Arc::new(Mutex::new(None)),
    sessions: Arc::new(Mutex::new(HashMap::new())),
```

- [ ] **Step 2: Add init_job_queue command**

Add a new Tauri command that initializes the job queue when the model is loaded:

```rust
#[tauri::command]
fn init_job_queue(state: State<'_, AppState>) -> Result<(), String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    let transcriber = state.transcriber.clone();
    let queue = JobQueue::new(settings.max_workers, transcriber);
    *state.job_queue.lock().map_err(|e| e.to_string())? = Some(queue);
    Ok(())
}
```

- [ ] **Step 3: Add submit_dictation command**

```rust
#[tauri::command]
fn submit_dictation(
    state: State<'_, AppState>,
    session_id: String,
    audio: Vec<f32>,
    language: String,
    chunk_index: u32,
    target_hwnd: usize,
) -> Result<String, String> {
    let session_uuid = Uuid::parse_str(&session_id).map_err(|e| e.to_string())?;
    let job = TranscriptionJob {
        id: Uuid::new_v4(),
        audio,
        target_hwnd,
        language,
        job_type: JobType::Dictation,
        chunk_index: Some(chunk_index),
        session_id: session_uuid,
        created_at: std::time::Instant::now(),
        status: JobStatus::Queued,
    };

    let queue_guard = state.job_queue.lock().map_err(|e| e.to_string())?;
    let queue = queue_guard.as_ref().ok_or("Job queue not initialized")?;
    let job_id = queue.submit(job);
    Ok(job_id.to_string())
}
```

- [ ] **Step 4: Add get_queue_status command**

```rust
#[tauri::command]
fn get_queue_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let queue_guard = state.job_queue.lock().map_err(|e| e.to_string())?;
    let queue = queue_guard.as_ref().ok_or("Job queue not initialized")?;
    let status = queue.get_status();
    serde_json::to_value(&status).map_err(|e| e.to_string())
}
```

Note: Add `#[derive(serde::Serialize)]` to `QueueStatus` and `SessionInfo` in `job_queue.rs`.

- [ ] **Step 5: Add get_completed_sessions command**

```rust
#[tauri::command]
fn get_completed_sessions(state: State<'_, AppState>) -> Result<Vec<(String, usize, String)>, String> {
    let queue_guard = state.job_queue.lock().map_err(|e| e.to_string())?;
    let queue = queue_guard.as_ref().ok_or("Job queue not initialized")?;
    let sessions = queue.get_completed_sessions();
    Ok(sessions.iter().map(|(id, hwnd, text)| (id.to_string(), *hwnd, text.clone())).collect())
}
```

- [ ] **Step 6: Register new commands in the Tauri builder**

In the `.invoke_handler(tauri::generate_handler![...])` call, add:

```rust
    init_job_queue,
    submit_dictation,
    get_queue_status,
    get_completed_sessions,
```

- [ ] **Step 7: Build and verify**

Run: `cd src-tauri && cargo build 2>&1 | head -30`
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/job_queue.rs
git commit -m "feat: integrate job queue into AppState with Tauri commands"
```

---

### Task 5: Refactor start_dictation/stop_dictation for Multi-Session

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Update start_dictation to create a session**

Replace the current `start_dictation` command (lines ~314-350) to also create a session and return the session ID:

```rust
#[tauri::command]
fn start_dictation(state: State<'_, AppState>) -> Result<String, String> {
    // Capture foreground window
    let hwnd = {
        #[cfg(target_os = "windows")]
        {
            extern "system" { fn GetForegroundWindow() -> usize; }
            unsafe { GetForegroundWindow() }
        }
        #[cfg(not(target_os = "windows"))]
        { 0usize }
    };

    *state.dictation_source_window.lock().map_err(|e| e.to_string())? = hwnd;

    // Get or create recorder
    let mut recorder_guard = state.recorder.lock().map_err(|e| e.to_string())?;
    let is_recording = *state.is_recording.lock().map_err(|e| e.to_string())?;

    if is_recording {
        // Meeting active — just activate dictation buffer
        if let Some(ref recorder) = *recorder_guard {
            recorder.start_dictation();
        }
    } else {
        // No meeting — create fresh recorder
        let settings = state.settings.lock().map_err(|e| e.to_string())?;
        let mut recorder = AudioRecorder::new();
        recorder.start(&settings.audio_device).map_err(|e| e.to_string())?;
        recorder.start_dictation();
        *recorder_guard = Some(recorder);
    }

    *state.is_dictating.lock().map_err(|e| e.to_string())? = true;

    // Create session in job queue
    let language = state.settings.lock().map_err(|e| e.to_string())?.language.clone();
    let queue_guard = state.job_queue.lock().map_err(|e| e.to_string())?;
    if let Some(ref queue) = *queue_guard {
        let session_id = queue.create_session(hwnd, language);
        return Ok(session_id.to_string());
    }

    Ok(Uuid::new_v4().to_string())
}
```

- [ ] **Step 2: Update stop_dictation to submit jobs to queue**

Replace the current `stop_dictation` command (lines ~352-419) to submit audio chunks to the job queue instead of transcribing synchronously:

```rust
#[tauri::command]
fn stop_dictation(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    *state.is_dictating.lock().map_err(|e| e.to_string())? = false;

    let audio = {
        let recorder_guard = state.recorder.lock().map_err(|e| e.to_string())?;
        match &*recorder_guard {
            Some(recorder) => recorder.stop_dictation(),
            None => return Err("No recorder active".to_string()),
        }
    };

    // Stop recorder if no meeting is active
    let is_recording = *state.is_recording.lock().map_err(|e| e.to_string())?;
    if !is_recording {
        let mut recorder_guard = state.recorder.lock().map_err(|e| e.to_string())?;
        if let Some(recorder) = recorder_guard.take() {
            let _ = recorder.stop();
        }
    }

    if audio.is_empty() {
        return Err("No audio captured".to_string());
    }

    let session_uuid = Uuid::parse_str(&session_id).map_err(|e| e.to_string())?;
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    let language = settings.language.clone();
    let interval = settings.incremental_interval_secs;
    let target_hwnd = *state.dictation_source_window.lock().map_err(|e| e.to_string())?;

    let queue_guard = state.job_queue.lock().map_err(|e| e.to_string())?;
    let queue = queue_guard.as_ref().ok_or("Job queue not initialized")?;

    // Split audio into chunks based on interval
    let samples_per_chunk = (interval * 16000.0) as usize;
    let chunks: Vec<Vec<f32>> = if samples_per_chunk > 0 && audio.len() > samples_per_chunk {
        audio.chunks(samples_per_chunk).map(|c| c.to_vec()).collect()
    } else {
        vec![audio]
    };

    let total_chunks = chunks.len() as u32;
    for (i, chunk) in chunks.into_iter().enumerate() {
        let job = TranscriptionJob {
            id: Uuid::new_v4(),
            audio: chunk,
            target_hwnd,
            language: language.clone(),
            job_type: JobType::Dictation,
            chunk_index: Some(i as u32),
            session_id: session_uuid,
            created_at: std::time::Instant::now(),
            status: JobStatus::Queued,
        };
        queue.submit(job);
    }
    queue.finalize_session_chunks(session_uuid, total_chunks);

    Ok(())
}
```

- [ ] **Step 3: Keep the old stop_dictation as stop_dictation_sync for backward compatibility**

Rename the old function to `stop_dictation_sync` (keep for file transcription and fallback). The original code from lines 352-419 stays but under a new name. Add it to the invoke handler.

- [ ] **Step 4: Build and verify**

Run: `cd src-tauri && cargo build 2>&1 | head -30`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: refactor start/stop_dictation to use job queue with chunked submission"
```

---

### Task 6: Frontend API Bindings for Job Queue

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Add new API functions**

In `src/lib/api.ts`, in the Tauri API section, add these functions:

```typescript
async startDictation(): Promise<string> {
    // Returns session_id instead of void
    return await invoke('start_dictation') as string;
},

async stopDictationAsync(sessionId: string): Promise<void> {
    await invoke('stop_dictation', { sessionId });
},

async getQueueStatus(): Promise<QueueStatus> {
    return await invoke('get_queue_status') as QueueStatus;
},

async getCompletedSessions(): Promise<Array<[string, number, string]>> {
    return await invoke('get_completed_sessions') as Array<[string, number, string]>;
},

async initJobQueue(): Promise<void> {
    await invoke('init_job_queue');
},
```

- [ ] **Step 2: Add TypeScript interfaces**

```typescript
export interface QueueStatus {
    queued: number;
    active: number;
    completed: number;
    sessions: SessionInfo[];
}

export interface SessionInfo {
    session_id: string;
    status: string;
    completed_chunks: number;
    total_chunks: number;
    current_progress_pct: number;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: add frontend API bindings for job queue"
```

---

### Task 7: Refactor App.tsx for Multi-Session Recording

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add session tracking state**

In the App component, add:

```typescript
const [activeSessions, setActiveSessions] = createSignal<Map<string, string>>(new Map());
// Map<sessionId, status>

let completionPollInterval: number | undefined;
```

- [ ] **Step 2: Update handleStartRecording**

Replace the recording start logic (lines ~292-310):

```typescript
const handleStartRecording = async () => {
    if (!isModelLoaded()) return;

    try {
        const sessionId = await api.startDictation();
        setActiveSessions(prev => {
            const next = new Map(prev);
            next.set(sessionId, 'recording');
            return next;
        });

        if (settings()?.audio_feedback) soundRecordStart();
        showOverlay('recording', '');
        startAudioLevelPolling();
    } catch (err) {
        console.error('Failed to start dictation:', err);
    }
};
```

- [ ] **Step 3: Update handleStopRecording**

Replace the recording stop logic (lines ~312-343):

```typescript
const handleStopRecording = async () => {
    stopAudioLevelPolling();
    if (settings()?.audio_feedback) soundRecordStop();

    // Get the most recent session ID
    const sessions = activeSessions();
    const sessionId = Array.from(sessions.entries())
        .filter(([_, status]) => status === 'recording')
        .pop()?.[0];

    if (!sessionId) return;

    setActiveSessions(prev => {
        const next = new Map(prev);
        next.set(sessionId, 'transcribing');
        return next;
    });

    try {
        await api.stopDictationAsync(sessionId);
        showOverlay('transcribing', '');

        // Start polling for completed sessions
        if (!completionPollInterval) {
            completionPollInterval = window.setInterval(pollCompletedSessions, 200);
        }
    } catch (err) {
        showOverlay('error', String(err));
    }
};
```

- [ ] **Step 4: Add completion polling**

```typescript
const pollCompletedSessions = async () => {
    try {
        const completed = await api.getCompletedSessions();
        for (const [sessionId, hwnd, text] of completed) {
            // Apply dictionary corrections on frontend if needed
            const finalText = text.trim();

            if (finalText && settings()?.auto_paste) {
                await api.typeText(finalText);
                // 100ms delay between pastes for focus switching
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Update transcription history
            setTranscriptions(prev => [{
                text: finalText,
                timestamp: new Date(),
                language: settings()?.language || 'nl',
            }, ...prev]);

            // Remove from active sessions
            setActiveSessions(prev => {
                const next = new Map(prev);
                next.delete(sessionId);
                return next;
            });

            if (settings()?.audio_feedback) soundTranscriptionDone();
            showOverlay('done', finalText.substring(0, 50));
        }

        // Stop polling if no more active sessions
        const remaining = activeSessions();
        const hasActive = Array.from(remaining.values()).some(s => s === 'transcribing');
        if (!hasActive && completionPollInterval) {
            clearInterval(completionPollInterval);
            completionPollInterval = undefined;
        }
    } catch (err) {
        console.error('Poll error:', err);
    }
};
```

- [ ] **Step 5: Initialize job queue on model load**

In the model loading logic (where `isModelLoaded` becomes true), add:

```typescript
await api.initJobQueue();
```

- [ ] **Step 6: Build and test in dev mode**

Run: `npm run dev`
Expected: Vite starts on port 3025 without errors.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: refactor App.tsx for multi-session recording with job queue polling"
```

---

### Task 8: Progress Events from Workers

**Files:**
- Modify: `src-tauri/src/transcriber.rs`
- Modify: `src-tauri/src/job_queue.rs`

- [ ] **Step 1: Add progress parsing to transcriber**

In `src-tauri/src/transcriber.rs`, modify the `transcribe()` method to accept an optional progress callback. After spawning the whisper.cpp process, read stderr line-by-line and parse `progress = XX%`:

```rust
pub fn transcribe_with_progress<F>(
    &self,
    audio_data: &[f32],
    language: &str,
    on_progress: F,
) -> Result<String, String>
where
    F: Fn(u8) + Send + 'static,
{
    // ... (same as existing transcribe() but with stderr parsing)
    // After spawning child process:
    let stderr = child.stderr.take();
    if let Some(stderr) = stderr {
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                // Parse "progress = XX%"
                if let Some(pct_str) = line.strip_prefix("progress = ") {
                    if let Some(pct_str) = pct_str.strip_suffix('%') {
                        if let Ok(pct) = pct_str.trim().parse::<u8>() {
                            on_progress(pct);
                        }
                    }
                }
            }
        }
    }
    // ... rest of transcription logic
}
```

Note: The whisper.cpp binary must be called with `--print-progress` flag. Add this to `apply_common_args()`.

- [ ] **Step 2: Update worker in job_queue.rs to emit progress events**

In the worker thread spawn in `try_dispatch_workers()`, use `transcribe_with_progress` and emit Tauri events:

```rust
// In the worker thread, replace the transcribe call:
let result_text = match transcriber {
    Some(t) => {
        t.transcribe_with_progress(&job.audio, &job.language, move |pct| {
            // Progress will be collected via the results channel
            // For now just log it
            eprintln!("Job {} progress: {}%", job_id, pct);
        }).unwrap_or_default()
    },
    None => String::new(),
};
```

- [ ] **Step 3: Build and verify**

Run: `cd src-tauri && cargo build 2>&1 | head -30`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/transcriber.rs src-tauri/src/job_queue.rs
git commit -m "feat: add progress parsing from whisper.cpp stderr output"
```

---

## Phase 2: UI Improvements

> Overlay redesign, retro sounds, audio level bar. Can be done independently of Phase 1 backend changes.

---

### Task 9: Overlay Flicker Fix and Pre-creation

**Files:**
- Modify: `src/App.tsx` (overlay window management)
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Add overlay window to tauri.conf.json**

In `src-tauri/tauri.conf.json`, in the `"windows"` array, add a second window definition for the overlay that starts hidden:

```json
{
    "label": "dictation-overlay",
    "url": "/overlay.html",
    "width": 200,
    "height": 48,
    "resizable": false,
    "decorations": false,
    "transparent": true,
    "alwaysOnTop": true,
    "skipTaskbar": true,
    "visible": false,
    "x": 0,
    "y": 0
}
```

- [ ] **Step 2: Create overlay.html entry point**

Create `src/overlay.html` (or route in the existing SPA). This should load only the DictationOverlay component, not the full app.

If the existing app uses a single `index.html`, use Tauri's multi-window approach where the overlay window loads the same app but renders differently based on the window label.

- [ ] **Step 3: Update showOverlay in App.tsx to use show/hide instead of create/destroy**

Replace the overlay creation logic (lines ~41-95) to just show/hide the pre-created window:

```typescript
const showOverlay = async (state: string, text: string) => {
    const overlayWindow = await WebviewWindow.getByLabel('dictation-overlay');
    if (overlayWindow) {
        // Position bottom-right
        const monitor = await currentMonitor();
        if (monitor) {
            const x = monitor.size.width - 216;
            const y = monitor.size.height - 64 - 48;
            await overlayWindow.setPosition(new PhysicalPosition(x, y));
        }
        await overlayWindow.emit('overlay-state', state);
        await overlayWindow.emit('overlay-text', text);
        await overlayWindow.show();
    }
};

const hideOverlay = async () => {
    const overlayWindow = await WebviewWindow.getByLabel('dictation-overlay');
    if (overlayWindow) {
        await overlayWindow.hide();
    }
};
```

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src-tauri/tauri.conf.json
git commit -m "fix: pre-create overlay window to eliminate flicker on show"
```

---

### Task 10: Compact Pill Overlay Redesign

**Files:**
- Modify: `src/components/DictationOverlay.tsx`

- [ ] **Step 1: Redesign the overlay to compact pill shape**

Replace the entire `DictationOverlay.tsx` content with the new compact design:

```tsx
import { createSignal, onMount, onCleanup, Show } from 'solid-js';
import { listen } from '@tauri-apps/api/event';

export default function DictationOverlay() {
    const [state, setState] = createSignal<'recording' | 'transcribing' | 'done' | 'error'>('recording');
    const [text, setText] = createSignal('');
    const [audioLevel, setAudioLevel] = createSignal(0);
    const [progressPct, setProgressPct] = createSignal(0);
    const [visible, setVisible] = createSignal(false);

    onMount(() => {
        const unlisten1 = listen('overlay-state', (e: any) => {
            setState(e.payload as any);
            setVisible(true);

            if (e.payload === 'done') {
                setTimeout(() => setVisible(false), 2000);
            } else if (e.payload === 'error') {
                setTimeout(() => setVisible(false), 3000);
            }
        });

        const unlisten2 = listen('overlay-text', (e: any) => {
            setText(e.payload as string);
        });

        const unlisten3 = listen('overlay-audio-level', (e: any) => {
            setAudioLevel(prev => prev * 0.3 + (e.payload as number) * 0.7);
        });

        const unlisten4 = listen('overlay-progress', (e: any) => {
            setProgressPct(e.payload as number);
        });

        onCleanup(() => {
            unlisten1.then(f => f());
            unlisten2.then(f => f());
            unlisten3.then(f => f());
            unlisten4.then(f => f());
        });
    });

    const dotColor = () => {
        switch (state()) {
            case 'recording': return '#e74c3c';
            case 'transcribing': return '#3498db';
            case 'done': return '#27ae60';
            case 'error': return '#e74c3c';
        }
    };

    return (
        <div
            style={{
                opacity: visible() ? 1 : 0,
                transition: 'opacity 50ms ease-in',
                display: 'flex',
                'align-items': 'center',
                gap: '8px',
                background: '#1e1e2e',
                'border-radius': '24px',
                padding: '8px 16px',
                'box-shadow': '0 4px 12px rgba(0,0,0,0.4)',
                'font-family': 'system-ui, sans-serif',
            }}
        >
            {/* Status dot */}
            <div style={{
                width: '8px',
                height: '8px',
                'border-radius': '50%',
                background: dotColor(),
                'box-shadow': `0 0 8px ${dotColor()}`,
            }} />

            {/* Center icon */}
            <Show when={state() === 'recording'}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                </svg>
            </Show>
            <Show when={state() === 'transcribing'}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2"
                     style={{ animation: 'spin 1s linear infinite' }}>
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                </svg>
            </Show>
            <Show when={state() === 'done'}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#27ae60" stroke-width="2.5">
                    <path d="M20 6L9 17l-5-5"/>
                </svg>
            </Show>
            <Show when={state() === 'error'}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2.5">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </Show>

            {/* Right: level bar / progress / text */}
            <Show when={state() === 'recording'}>
                <div style={{
                    width: '100px',
                    height: '6px',
                    background: '#333',
                    'border-radius': '3px',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        width: `${Math.min(100, audioLevel() * 100)}%`,
                        height: '6px',
                        background: audioLevel() > 0.8 ? '#e74c3c' : audioLevel() > 0.5 ? '#f1c40f' : '#27ae60',
                        'border-radius': '3px',
                        transition: 'width 80ms ease-out',
                    }} />
                </div>
            </Show>
            <Show when={state() === 'transcribing'}>
                <div style={{
                    width: '100px',
                    height: '6px',
                    background: '#333',
                    'border-radius': '3px',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        width: `${progressPct()}%`,
                        height: '6px',
                        background: '#3498db',
                        'border-radius': '3px',
                        transition: 'width 200ms ease-out',
                    }} />
                </div>
            </Show>
            <Show when={state() === 'done'}>
                <span style={{ color: '#ccc', 'font-size': '11px', 'max-width': '120px', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                    {text()}
                </span>
            </Show>
            <Show when={state() === 'error'}>
                <span style={{ color: '#e74c3c', 'font-size': '11px', 'max-width': '120px', overflow: 'hidden' }}>
                    {text()}
                </span>
            </Show>
        </div>
    );
}
```

- [ ] **Step 2: Add CSS spin animation**

In the overlay's CSS (or inline style tag):

```css
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/DictationOverlay.tsx
git commit -m "feat: redesign dictation overlay to compact 200x48 pill shape"
```

---

### Task 11: Retro Sound System — Sound Files and Playback

**Files:**
- Create: `sounds/success/` (directory with WAV files)
- Create: `sounds/start/` (directory with WAV files)
- Create: `sounds/error/` (directory with WAV files)
- Modify: `src/lib/sounds.ts`

- [ ] **Step 1: Generate chiptune sound files**

Create a Node.js script to generate 8-bit style WAV files synthetically (avoiding copyright issues). Create `scripts/generate-sounds.js`:

```javascript
const fs = require('fs');
const path = require('path');

function writeWav(filename, sampleRate, samples) {
    const buffer = Buffer.alloc(44 + samples.length * 2);
    // WAV header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + samples.length * 2, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);      // PCM
    buffer.writeUInt16LE(1, 22);      // Mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(samples.length * 2, 40);
    for (let i = 0; i < samples.length; i++) {
        buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
    }
    fs.writeFileSync(filename, buffer);
}

function squareWave(freq, duration, sr = 22050) {
    const samples = [];
    for (let i = 0; i < sr * duration; i++) {
        const t = i / sr;
        const env = Math.min(1, Math.max(0, 1 - t / duration)) * 0.6;
        samples.push((Math.sin(2 * Math.PI * freq * t) > 0 ? 1 : -1) * env);
    }
    return samples;
}

function coinSound(sr = 22050) {
    const samples = [];
    const dur = 0.4;
    for (let i = 0; i < sr * dur; i++) {
        const t = i / sr;
        const freq = t < 0.15 ? 988 : 1319;  // B5 → E6
        const env = Math.max(0, 1 - t / dur) * 0.5;
        samples.push((Math.sin(2 * Math.PI * freq * t) > 0 ? 1 : -1) * env);
    }
    return samples;
}

function powerUp(sr = 22050) {
    const samples = [];
    const dur = 0.6;
    for (let i = 0; i < sr * dur; i++) {
        const t = i / sr;
        const freq = 200 + (t / dur) * 800;  // Rising
        const env = Math.max(0, 1 - t / dur) * 0.5;
        samples.push((Math.sin(2 * Math.PI * freq * t) > 0 ? 1 : -1) * env);
    }
    return samples;
}

function levelClear(sr = 22050) {
    const samples = [];
    const notes = [523, 659, 784, 1047];  // C5 E5 G5 C6
    const noteDur = 0.12;
    for (let n = 0; n < notes.length; n++) {
        for (let i = 0; i < sr * noteDur; i++) {
            const t = i / sr;
            const env = Math.max(0, 1 - t / noteDur) * 0.5;
            samples.push((Math.sin(2 * Math.PI * notes[n] * t) > 0 ? 1 : -1) * env);
        }
    }
    return samples;
}

function secretFound(sr = 22050) {
    const samples = [];
    const notes = [440, 554, 659, 880, 659, 554, 440, 880];
    const noteDur = 0.08;
    for (const freq of notes) {
        for (let i = 0; i < sr * noteDur; i++) {
            const t = i / sr;
            const env = Math.max(0, 1 - t / noteDur) * 0.4;
            samples.push(Math.sin(2 * Math.PI * freq * t) * env);
        }
    }
    return samples;
}

// Generate success sounds
const successDir = path.join(__dirname, '..', 'sounds', 'success');
fs.mkdirSync(successDir, { recursive: true });
writeWav(path.join(successDir, 'coin.wav'), 22050, coinSound());
writeWav(path.join(successDir, 'power-up.wav'), 22050, powerUp());
writeWav(path.join(successDir, 'level-clear.wav'), 22050, levelClear());
writeWav(path.join(successDir, 'secret.wav'), 22050, secretFound());
writeWav(path.join(successDir, 'victory-fanfare.wav'), 22050, (() => {
    const notes = [523, 523, 523, 698, 880, 784, 880, 1047];
    const durs = [0.1, 0.1, 0.1, 0.15, 0.15, 0.1, 0.1, 0.3];
    const s = [];
    for (let n = 0; n < notes.length; n++) {
        for (let i = 0; i < 22050 * durs[n]; i++) {
            const t = i / 22050;
            const env = Math.max(0, 1 - t / durs[n]) * 0.5;
            s.push((Math.sin(2 * Math.PI * notes[n] * t) > 0 ? 1 : -1) * env);
        }
    }
    return s;
})());
writeWav(path.join(successDir, 'star-collect.wav'), 22050, (() => {
    const s = [];
    for (let i = 0; i < 22050 * 0.3; i++) {
        const t = i / 22050;
        const freq = 880 + Math.sin(t * 30) * 200;
        s.push(Math.sin(2 * Math.PI * freq * t) * Math.max(0, 1 - t / 0.3) * 0.5);
    }
    return s;
})());
writeWav(path.join(successDir, 'gem-pickup.wav'), 22050, (() => {
    const s = [];
    for (let i = 0; i < 22050 * 0.25; i++) {
        const t = i / 22050;
        const freq = 1200 + t * 800;
        s.push(Math.sin(2 * Math.PI * freq * t) * Math.max(0, 1 - t / 0.25) * 0.4);
    }
    return s;
})());
writeWav(path.join(successDir, 'checkpoint.wav'), 22050, (() => {
    const notes = [659, 784, 988];
    const s = [];
    for (const f of notes) {
        for (let i = 0; i < 22050 * 0.1; i++) {
            const t = i / 22050;
            s.push((Math.sin(2 * Math.PI * f * t) > 0 ? 1 : -1) * Math.max(0, 1 - t / 0.1) * 0.4);
        }
    }
    return s;
})());

// Generate start sounds
const startDir = path.join(__dirname, '..', 'sounds', 'start');
fs.mkdirSync(startDir, { recursive: true });
writeWav(path.join(startDir, 'blip-up.wav'), 22050, (() => {
    const s = [];
    for (let i = 0; i < 22050 * 0.15; i++) {
        const t = i / 22050;
        const freq = 400 + t / 0.15 * 600;
        s.push((Math.sin(2 * Math.PI * freq * t) > 0 ? 1 : -1) * Math.max(0, 1 - t / 0.15) * 0.5);
    }
    return s;
})());
writeWav(path.join(startDir, 'ready.wav'), 22050, squareWave(880, 0.1));
writeWav(path.join(startDir, 'ping.wav'), 22050, (() => {
    const s = [];
    for (let i = 0; i < 22050 * 0.2; i++) {
        const t = i / 22050;
        s.push(Math.sin(2 * Math.PI * 1200 * t) * Math.max(0, 1 - t / 0.2) * 0.4);
    }
    return s;
})());

// Generate error sounds
const errorDir = path.join(__dirname, '..', 'sounds', 'error');
fs.mkdirSync(errorDir, { recursive: true });
writeWav(path.join(errorDir, 'fail.wav'), 22050, (() => {
    const s = [];
    for (let i = 0; i < 22050 * 0.4; i++) {
        const t = i / 22050;
        const freq = 300 - t / 0.4 * 150;
        s.push((Math.sin(2 * Math.PI * freq * t) > 0 ? 1 : -1) * Math.max(0, 1 - t / 0.4) * 0.5);
    }
    return s;
})());
writeWav(path.join(errorDir, 'buzz.wav'), 22050, (() => {
    const s = [];
    for (let i = 0; i < 22050 * 0.3; i++) {
        const t = i / 22050;
        s.push((Math.sin(2 * Math.PI * 150 * t) > 0 ? 1 : -1) * Math.max(0, 1 - t / 0.3) * 0.4);
    }
    return s;
})());

console.log('Generated all sounds!');
```

Run: `node scripts/generate-sounds.js`
Expected: Creates `sounds/success/`, `sounds/start/`, `sounds/error/` directories with WAV files.

- [ ] **Step 2: Rewrite sounds.ts for WAV playback with preference learning**

Replace `src/lib/sounds.ts`:

```typescript
let audioCtx: AudioContext | null = null;
const soundBuffers: Map<string, AudioBuffer> = new Map();
const SOUND_PREF_KEY = 'oss_sound_prefs';

interface SoundPreference {
    file: string;
    likes: number;
    plays: number;
    weight: number;
}

let soundPrefs: Map<string, SoundPreference> = new Map();
let lastPlayedSound: string | null = null;

export function initSounds() {
    if (!audioCtx) {
        audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    loadPreferences();
}

function loadPreferences() {
    try {
        const stored = localStorage.getItem(SOUND_PREF_KEY);
        if (stored) {
            const arr: SoundPreference[] = JSON.parse(stored);
            soundPrefs = new Map(arr.map(p => [p.file, p]));
        }
    } catch {}
}

function savePreferences() {
    localStorage.setItem(SOUND_PREF_KEY, JSON.stringify(Array.from(soundPrefs.values())));
}

async function loadSoundFile(path: string): Promise<AudioBuffer | null> {
    if (soundBuffers.has(path)) return soundBuffers.get(path)!;
    try {
        if (!audioCtx) return null;
        const response = await fetch(path);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = await audioCtx.decodeAudioData(arrayBuffer);
        soundBuffers.set(path, buffer);
        return buffer;
    } catch {
        return null;
    }
}

function playBuffer(buffer: AudioBuffer, volume: number = 0.7) {
    if (!audioCtx) return;
    const source = audioCtx.createBufferSource();
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = volume;
    source.buffer = buffer;
    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    source.start();
}

async function getSoundFiles(category: string): Promise<string[]> {
    // In Tauri, sounds are bundled as resources
    // For now, use a hardcoded list matching generated files
    const sounds: Record<string, string[]> = {
        success: [
            'coin.wav', 'power-up.wav', 'level-clear.wav', 'secret.wav',
            'victory-fanfare.wav', 'star-collect.wav', 'gem-pickup.wav', 'checkpoint.wav',
        ],
        start: ['blip-up.wav', 'ready.wav', 'ping.wav'],
        error: ['fail.wav', 'buzz.wav'],
    };
    return (sounds[category] || []).map(f => `/sounds/${category}/${f}`);
}

function getWeight(file: string): number {
    const pref = soundPrefs.get(file);
    if (!pref) return 1.0;
    if (pref.likes > 0) return 1.0 + pref.likes * 2.0;
    if (pref.plays >= 5) return Math.max(0.1, 1.0 - pref.plays * 0.1);
    return 1.0;
}

function weightedRandomPick(files: string[]): string {
    const weights = files.map(f => getWeight(f));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < files.length; i++) {
        r -= weights[i];
        if (r <= 0) return files[i];
    }
    return files[files.length - 1];
}

async function playCategorySound(category: string, volume: number = 0.7): Promise<string | null> {
    const files = await getSoundFiles(category);
    if (files.length === 0) return null;

    const chosen = weightedRandomPick(files);
    const buffer = await loadSoundFile(chosen);
    if (buffer) {
        playBuffer(buffer, volume);

        // Track plays
        const pref = soundPrefs.get(chosen) || { file: chosen, likes: 0, plays: 0, weight: 1.0 };
        pref.plays++;
        pref.weight = getWeight(chosen);
        soundPrefs.set(chosen, pref);
        savePreferences();

        lastPlayedSound = chosen;
        return chosen;
    }
    return null;
}

export async function soundRecordStart(volume: number = 0.7) {
    await playCategorySound('start', volume);
}

export async function soundRecordStop(volume: number = 0.7) {
    // Use a simple blip-down for stop (reuse start sounds for now)
    await playCategorySound('start', volume * 0.8);
}

export async function soundTranscriptionDone(volume: number = 0.7): Promise<string | null> {
    return playCategorySound('success', volume);
}

export async function soundError(volume: number = 0.7) {
    await playCategorySound('error', volume);
}

export function likeLastSound() {
    if (!lastPlayedSound) return;
    const pref = soundPrefs.get(lastPlayedSound);
    if (pref) {
        pref.likes++;
        pref.weight = getWeight(lastPlayedSound);
        soundPrefs.set(lastPlayedSound, pref);
        savePreferences();
    }
}

export function getLastPlayedSound(): string | null {
    return lastPlayedSound;
}

// Fallback: original synthesized tones (for "classic" sound pack)
function playTone(freq: number, duration: number, type: OscillatorType = 'square', gain: number = 0.3) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    g.gain.setValueAtTime(gain, audioCtx.currentTime);
    g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + duration);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

export function soundRecordStartClassic() {
    playTone(600, 0.15);
    setTimeout(() => playTone(900, 0.15), 50);
}

export function soundTranscriptionDoneClassic() {
    playTone(523, 0.2, 'sine', 0.2);
    setTimeout(() => playTone(659, 0.2, 'sine', 0.2), 100);
    setTimeout(() => playTone(784, 0.35, 'sine', 0.15), 200);
}

export function soundErrorClassic() {
    playTone(220, 0.25, 'square', 0.2);
    setTimeout(() => playTone(180, 0.3, 'square', 0.2), 280);
}
```

- [ ] **Step 3: Preload sounds on app init**

In `src/App.tsx`, after `initSounds()`, preload all sound files:

```typescript
// After initSounds():
const categories = ['success', 'start', 'error'];
for (const cat of categories) {
    const files = await getSoundFiles(cat);
    for (const f of files) {
        await loadSoundFile(f);
    }
}
```

- [ ] **Step 4: Bundle sounds in Tauri**

In `src-tauri/tauri.conf.json`, add to the `bundle.resources` array:

```json
"../sounds/**/*"
```

- [ ] **Step 5: Run the sound generator and commit**

```bash
node scripts/generate-sounds.js
git add sounds/ scripts/generate-sounds.js src/lib/sounds.ts src-tauri/tauri.conf.json
git commit -m "feat: retro chiptune sound system with weighted random selection and preference learning"
```

---

### Task 12: Thumbs Up UI in Overlay

**Files:**
- Modify: `src/components/DictationOverlay.tsx`
- Modify: `src/lib/sounds.ts` (already done in Task 11)

- [ ] **Step 1: Add thumbs-up button to the "done" state**

In `DictationOverlay.tsx`, in the "done" Show block, add a thumbs-up button that appears for 3 seconds:

```tsx
const [showThumbsUp, setShowThumbsUp] = createSignal(false);

// In the overlay-state listener, when state is 'done':
if (e.payload === 'done') {
    setShowThumbsUp(true);
    setTimeout(() => setShowThumbsUp(false), 3000);
    setTimeout(() => setVisible(false), 3000);
}

// In the JSX, after the done text:
<Show when={state() === 'done' && showThumbsUp()}>
    <button
        onClick={() => {
            likeLastSound();
            setShowThumbsUp(false);
        }}
        style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            'font-size': '14px',
            padding: '0 4px',
            opacity: 0.7,
        }}
        title="Like this sound"
    >
        👍
    </button>
</Show>
```

- [ ] **Step 2: Import likeLastSound**

```typescript
import { likeLastSound } from '../lib/sounds';
```

- [ ] **Step 3: Commit**

```bash
git add src/components/DictationOverlay.tsx
git commit -m "feat: add thumbs-up button in overlay for sound preference learning"
```

---

## Phase 3: Meeting Enhancements

> Crash-safe meeting writer, floating indicator, integration with job queue.

---

### Task 13: Meeting Writer Module (Backend)

**Files:**
- Create: `src-tauri/src/meeting_writer.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod meeting_writer;`)

- [ ] **Step 1: Create meeting_writer.rs**

```rust
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use chrono::{Local, NaiveDateTime};
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
    save_dir: PathBuf,
    md_path: PathBuf,
    json_path: PathBuf,
    metadata: MeetingMetadata,
    meeting_start: chrono::DateTime<Local>,
}

impl MeetingWriter {
    pub fn new(save_dir: &str, meeting_id: &str) -> Result<Self, String> {
        let save_dir = PathBuf::from(save_dir);
        fs::create_dir_all(&save_dir).map_err(|e| format!("Failed to create meeting dir: {}", e))?;

        let now = Local::now();
        let filename = now.format("%Y-%m-%d_meeting_%H-%M").to_string();
        let md_path = save_dir.join(format!("{}.md", filename));
        let json_path = save_dir.join(format!("{}.json", filename));

        // Write initial markdown header
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

        Ok(Self {
            save_dir,
            md_path,
            json_path,
            metadata,
            meeting_start: now,
        })
    }

    pub fn append_segment(
        &mut self,
        speaker: &str,
        speaker_confidence: f32,
        text: &str,
        duration_ms: u64,
    ) -> Result<(), String> {
        let now = Local::now();
        let timestamp = now.format("%H:%M:%S").to_string();

        // Append to markdown file
        let line = format!("[{}] {}: {}\n", timestamp, speaker, text);
        let mut md_file = OpenOptions::new()
            .append(true)
            .open(&self.md_path)
            .map_err(|e| format!("Failed to open md: {}", e))?;
        md_file.write_all(line.as_bytes()).map_err(|e| format!("Failed to write md: {}", e))?;
        md_file.sync_all().map_err(|e| format!("Failed to sync md: {}", e))?;

        // Update JSON metadata
        let segment = MeetingSegment {
            timestamp,
            speaker: speaker.to_string(),
            speaker_confidence,
            text: text.to_string(),
            duration_ms,
        };
        self.metadata.segments.push(segment);

        let json = serde_json::to_string_pretty(&self.metadata).map_err(|e| e.to_string())?;
        let mut json_file = OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&self.json_path)
            .map_err(|e| format!("Failed to open json: {}", e))?;
        json_file.write_all(json.as_bytes()).map_err(|e| format!("Failed to write json: {}", e))?;
        json_file.sync_all().map_err(|e| format!("Failed to sync json: {}", e))?;

        Ok(())
    }

    pub fn get_md_path(&self) -> &Path {
        &self.md_path
    }

    pub fn get_json_path(&self) -> &Path {
        &self.json_path
    }

    pub fn segment_count(&self) -> usize {
        self.metadata.segments.len()
    }
}
```

- [ ] **Step 2: Add chrono dependency**

In `src-tauri/Cargo.toml`:

```toml
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 3: Register module and add to AppState**

In `src-tauri/src/lib.rs`:

```rust
mod meeting_writer;

// Add to AppState:
    meeting_writer: Arc<Mutex<Option<meeting_writer::MeetingWriter>>>,
```

Initialize as `Arc::new(Mutex::new(None))`.

- [ ] **Step 4: Build and verify**

Run: `cd src-tauri && cargo build 2>&1 | head -30`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/meeting_writer.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat: add crash-safe MeetingWriter with incremental md/json output and fsync"
```

---

### Task 14: Floating Meeting Indicator

**Files:**
- Create: `src/components/MeetingIndicator.tsx`
- Modify: `src-tauri/tauri.conf.json` (add window)
- Modify: `src/App.tsx` (show/hide logic)

- [ ] **Step 1: Add meeting-indicator window to tauri.conf.json**

```json
{
    "label": "meeting-indicator",
    "url": "/indicator.html",
    "width": 140,
    "height": 32,
    "resizable": false,
    "decorations": false,
    "transparent": true,
    "alwaysOnTop": true,
    "skipTaskbar": true,
    "visible": false,
    "x": 0,
    "y": 0
}
```

- [ ] **Step 2: Create MeetingIndicator.tsx**

```tsx
import { createSignal, onMount, onCleanup } from 'solid-js';
import { listen } from '@tauri-apps/api/event';

export default function MeetingIndicator() {
    const [state, setState] = createSignal<'recording' | 'transcribing' | 'paused'>('recording');
    const [elapsed, setElapsed] = createSignal(0);
    let timerInterval: number | undefined;

    const formatTime = (secs: number) => {
        const h = Math.floor(secs / 3600).toString().padStart(2, '0');
        const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
        const s = (secs % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    };

    onMount(() => {
        timerInterval = window.setInterval(() => {
            if (state() !== 'paused') {
                setElapsed(prev => prev + 1);
            }
        }, 1000);

        const unlisten1 = listen('meeting-indicator-state', (e: any) => {
            setState(e.payload as any);
        });

        onCleanup(() => {
            if (timerInterval) clearInterval(timerInterval);
            unlisten1.then(f => f());
        });
    });

    const dotColor = () => {
        switch (state()) {
            case 'recording': return '#27ae60';
            case 'transcribing': return '#f39c12';
            case 'paused': return '#666';
        }
    };

    return (
        <div style={{
            display: 'inline-flex',
            'align-items': 'center',
            gap: '6px',
            background: '#1a1a2e',
            'border-radius': '20px',
            padding: '6px 14px',
            'box-shadow': '0 2px 8px rgba(0,0,0,0.3)',
            'font-family': 'system-ui, sans-serif',
            cursor: 'move',
            '-webkit-app-region': 'drag',
        }}>
            <div style={{
                width: '8px',
                height: '8px',
                background: dotColor(),
                'border-radius': '50%',
                'box-shadow': state() !== 'paused' ? `0 0 6px ${dotColor()}` : 'none',
            }} />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke={state() === 'paused' ? '#999' : '#e0e0e0'} stroke-width="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            </svg>
            <span style={{
                color: state() === 'paused' ? '#999' : '#e0e0e0',
                'font-size': '11px',
                'font-weight': '500',
                'font-variant-numeric': 'tabular-nums',
            }}>
                {formatTime(elapsed())}
            </span>
        </div>
    );
}
```

- [ ] **Step 3: Add show/hide logic in App.tsx**

In the meeting recording start/stop handlers:

```typescript
const showMeetingIndicator = async () => {
    if (!settings()?.floating_indicator) return;
    const indicator = await WebviewWindow.getByLabel('meeting-indicator');
    if (indicator) {
        const monitor = await currentMonitor();
        if (monitor) {
            const x = monitor.size.width - 160;
            const y = 16;
            await indicator.setPosition(new PhysicalPosition(x, y));
        }
        await indicator.show();
    }
};

const hideMeetingIndicator = async () => {
    const indicator = await WebviewWindow.getByLabel('meeting-indicator');
    if (indicator) {
        await indicator.hide();
    }
};
```

- [ ] **Step 4: Commit**

```bash
git add src/components/MeetingIndicator.tsx src-tauri/tauri.conf.json src/App.tsx
git commit -m "feat: add floating meeting indicator pill with timer and status dot"
```

---

### Task 15: Settings UI Updates

**Files:**
- Modify: `src/components/SettingsPanel.tsx`
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Add Transcription settings section**

In `SettingsPanel.tsx`, in the Speech tab (or create new Transcription section), add:

```tsx
{/* Incremental interval */}
<div class="setting-row">
    <label>{t('Incremental interval')}</label>
    <div class="setting-control">
        <input
            type="range"
            min="1"
            max="60"
            step="1"
            value={settings()?.incremental_interval_secs || 5}
            onInput={(e) => updateSetting('incremental_interval_secs', parseFloat(e.currentTarget.value))}
        />
        <span>{settings()?.incremental_interval_secs || 5}s</span>
    </div>
    <p class="setting-hint">{t('Shorter = faster but less accurate')}</p>
</div>

{/* Max workers */}
<div class="setting-row">
    <label>{t('Parallel workers')}</label>
    <select
        value={settings()?.max_workers || 2}
        onChange={(e) => updateSetting('max_workers', parseInt(e.currentTarget.value))}
    >
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3">3</option>
    </select>
</div>

{/* Auto-correction */}
<div class="setting-row">
    <label>{t('Auto-correction (LLM)')}</label>
    <input
        type="checkbox"
        checked={settings()?.auto_correct || false}
        onChange={(e) => updateSetting('auto_correct', e.currentTarget.checked)}
    />
</div>
```

- [ ] **Step 2: Add Meeting tab**

Add a new tab "Meeting" with:

```tsx
{/* Meeting save directory */}
<div class="setting-row">
    <label>{t('Save directory')}</label>
    <button onClick={async () => {
        const dir = await open({ directory: true });
        if (dir) updateSetting('meeting_save_dir', dir);
    }}>
        {settings()?.meeting_save_dir || '~/Documents/OSS Meetings'}
    </button>
</div>

{/* Speaker diarization toggle */}
<div class="setting-row">
    <label>{t('Speaker diarization')}</label>
    <input
        type="checkbox"
        checked={settings()?.speaker_diarization || false}
        onChange={(e) => updateSetting('speaker_diarization', e.currentTarget.checked)}
    />
</div>

{/* Floating indicator toggle */}
<div class="setting-row">
    <label>{t('Floating indicator')}</label>
    <input
        type="checkbox"
        checked={settings()?.floating_indicator ?? true}
        onChange={(e) => updateSetting('floating_indicator', e.currentTarget.checked)}
    />
</div>
```

- [ ] **Step 3: Add Sound settings**

In the Audio tab, add a Sounds section:

```tsx
{/* Sound pack */}
<div class="setting-row">
    <label>{t('Sound pack')}</label>
    <select
        value={settings()?.sound_pack || 'retro'}
        onChange={(e) => updateSetting('sound_pack', e.currentTarget.value)}
    >
        <option value="retro">{t('Retro Games')}</option>
        <option value="classic">{t('Classic Tones')}</option>
    </select>
</div>

{/* Volume */}
<div class="setting-row">
    <label>{t('Sound volume')}</label>
    <input
        type="range"
        min="0"
        max="100"
        step="5"
        value={(settings()?.sound_volume || 0.7) * 100}
        onInput={(e) => updateSetting('sound_volume', parseFloat(e.currentTarget.value) / 100)}
    />
    <span>{Math.round((settings()?.sound_volume || 0.7) * 100)}%</span>
</div>
```

- [ ] **Step 4: Update api.ts Settings interface**

Add the new fields to the `Settings` TypeScript interface:

```typescript
export interface Settings {
    // ... existing fields ...
    incremental_interval_secs: number;
    max_workers: number;
    auto_correct: boolean;
    auto_correct_model: string;
    meeting_save_dir: string;
    speaker_diarization: boolean;
    floating_indicator: boolean;
    sound_pack: string;
    sound_volume: number;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsPanel.tsx src/lib/api.ts
git commit -m "feat: add settings UI for incremental transcription, meeting, and sounds"
```

---

## Phase 4: AI Features

> Speaker diarization with ONNX, voice training, LLM auto-correction. These are the most complex features and can be implemented last.

---

### Task 16: ONNX Runtime Integration for Speaker Embeddings

**Files:**
- Create: `src-tauri/src/speaker.rs`
- Modify: `src-tauri/Cargo.toml` (add `ort` dependency)
- Modify: `src-tauri/src/lib.rs` (add `mod speaker;`)

- [ ] **Step 1: Add ort dependency**

In `src-tauri/Cargo.toml`:

```toml
ort = "2"
```

- [ ] **Step 2: Create speaker.rs with embedding extraction**

```rust
use ort::{Session, Value};
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakerProfile {
    pub name: String,
    pub embedding: Vec<f32>,
    pub created_at: String,
}

pub struct SpeakerMatcher {
    session: Option<Session>,
    profiles: Vec<SpeakerProfile>,
    threshold: f32,
    unknown_counter: u32,
    profiles_dir: PathBuf,
}

impl SpeakerMatcher {
    pub fn new(model_path: &Path, profiles_dir: &Path) -> Result<Self, String> {
        let session = if model_path.exists() {
            Some(
                Session::builder()
                    .map_err(|e| format!("ONNX session builder error: {}", e))?
                    .commit_from_file(model_path)
                    .map_err(|e| format!("Failed to load ONNX model: {}", e))?,
            )
        } else {
            None
        };

        let profiles_dir = profiles_dir.to_path_buf();
        fs::create_dir_all(&profiles_dir).map_err(|e| e.to_string())?;

        let profiles = Self::load_profiles(&profiles_dir)?;

        Ok(Self {
            session,
            profiles,
            threshold: 0.75,
            unknown_counter: 0,
            profiles_dir,
        })
    }

    fn load_profiles(dir: &Path) -> Result<Vec<SpeakerProfile>, String> {
        let mut profiles = Vec::new();
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                if entry.path().extension().map_or(false, |e| e == "json") {
                    if let Ok(data) = fs::read_to_string(entry.path()) {
                        if let Ok(profile) = serde_json::from_str::<SpeakerProfile>(&data) {
                            profiles.push(profile);
                        }
                    }
                }
            }
        }
        Ok(profiles)
    }

    pub fn extract_embedding(&self, audio: &[f32]) -> Result<Vec<f32>, String> {
        let session = self.session.as_ref().ok_or("Speaker model not loaded")?;

        // ECAPA-TDNN expects [1, num_samples] input
        let input_shape = vec![1, audio.len()];
        let input = Value::from_array((input_shape.as_slice(), audio))
            .map_err(|e| format!("Failed to create input tensor: {}", e))?;

        let outputs = session
            .run(ort::inputs![input].map_err(|e| e.to_string())?)
            .map_err(|e| format!("ONNX inference error: {}", e))?;

        let embedding_tensor = outputs
            .get(0)
            .ok_or("No output from model")?;

        let embedding: Vec<f32> = embedding_tensor
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Failed to extract embedding: {}", e))?
            .iter()
            .copied()
            .collect();

        Ok(embedding)
    }

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

    pub fn identify_speaker(&mut self, audio: &[f32]) -> Result<(String, f32), String> {
        let embedding = self.extract_embedding(audio)?;

        let mut best_match = String::new();
        let mut best_score: f32 = 0.0;

        for profile in &self.profiles {
            let score = Self::cosine_similarity(&embedding, &profile.embedding);
            if score > best_score {
                best_score = score;
                best_match = profile.name.clone();
            }
        }

        if best_score >= self.threshold {
            Ok((best_match, best_score))
        } else {
            self.unknown_counter += 1;
            Ok((format!("Onbekend {}", self.unknown_counter), best_score))
        }
    }

    pub fn train_profile(&mut self, name: &str, audio: &[f32]) -> Result<(), String> {
        let embedding = self.extract_embedding(audio)?;

        let profile = SpeakerProfile {
            name: name.to_string(),
            embedding,
            created_at: chrono::Local::now().to_rfc3339(),
        };

        // Save to disk
        let filename = format!("speaker_{}.json", name.to_lowercase().replace(' ', "_"));
        let path = self.profiles_dir.join(&filename);
        let json = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
        fs::write(&path, json).map_err(|e| format!("Failed to save profile: {}", e))?;

        self.profiles.push(profile);
        Ok(())
    }

    pub fn list_profiles(&self) -> Vec<String> {
        self.profiles.iter().map(|p| p.name.clone()).collect()
    }

    pub fn delete_profile(&mut self, name: &str) -> Result<(), String> {
        self.profiles.retain(|p| p.name != name);
        let filename = format!("speaker_{}.json", name.to_lowercase().replace(' ', "_"));
        let path = self.profiles_dir.join(&filename);
        if path.exists() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn reset_unknown_counter(&mut self) {
        self.unknown_counter = 0;
    }
}
```

- [ ] **Step 3: Register module and add Tauri commands**

In `src-tauri/src/lib.rs`:

```rust
mod speaker;

// Add to AppState:
    speaker_matcher: Arc<Mutex<Option<speaker::SpeakerMatcher>>>,

// Add commands:
#[tauri::command]
fn train_speaker(state: State<'_, AppState>, name: String, audio: Vec<f32>) -> Result<(), String> {
    let mut matcher = state.speaker_matcher.lock().map_err(|e| e.to_string())?;
    let matcher = matcher.as_mut().ok_or("Speaker matcher not initialized")?;
    matcher.train_profile(&name, &audio)
}

#[tauri::command]
fn list_speaker_profiles(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let matcher = state.speaker_matcher.lock().map_err(|e| e.to_string())?;
    let matcher = matcher.as_ref().ok_or("Speaker matcher not initialized")?;
    Ok(matcher.list_profiles())
}

#[tauri::command]
fn delete_speaker_profile(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let mut matcher = state.speaker_matcher.lock().map_err(|e| e.to_string())?;
    let matcher = matcher.as_mut().ok_or("Speaker matcher not initialized")?;
    matcher.delete_profile(&name)
}
```

Register these in the invoke handler.

- [ ] **Step 4: Build and verify**

Run: `cd src-tauri && cargo build 2>&1 | head -30`
Expected: Build succeeds (ort crate will download ONNX Runtime automatically).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/speaker.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat: add ONNX-based speaker embedding and matching with profile management"
```

---

### Task 17: Voice Training Wizard (Frontend)

**Files:**
- Create: `src/components/VoiceTraining.tsx`
- Modify: `src/components/SettingsPanel.tsx`
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Create VoiceTraining.tsx**

```tsx
import { createSignal, Show } from 'solid-js';
import * as api from '../lib/api';

const TRAINING_TEXTS: Record<string, string> = {
    nl: `De schrijver beschrijft hoe de schroevendraaier naast de schroef lag. Hij wist dat het niet klopte en ook niet zou kloppen. De ui en de uil stonden in het uurboek. Gereed of bereid, het verschil is verschrikkelijk klein. De acht nachten waren koud, maar de gracht bleef onbevroren. Scheveningse scholieren schrijven schitterende schaakstrategieën. De angst en de kracht van de nacht brengen licht.`,
    en: `The quick brown fox jumps over the lazy dog. She sells seashells by the seashore. Peter Piper picked a peck of pickled peppers. How much wood would a woodchuck chuck if a woodchuck could chuck wood? The sixth sick sheik's sixth sheep's sick. Red lorry yellow lorry. Unique New York, you know you need unique New York.`,
    de: `Fischers Fritz fischt frische Fische. Brautkleid bleibt Brautkleid und Blaukraut bleibt Blaukraut. Der Zahnarzt zieht Zähne mit Zahnarztzange im Zahnarztzimmer. Zwischen zwei Zwetschgenzweigen zwitschern zwei Schwalben. Schnecken erschrecken, wenn Schnecken an Schnecken schlecken.`,
};

interface Props {
    language: string;
    onComplete: () => void;
    onCancel: () => void;
}

export default function VoiceTraining(props: Props) {
    const [step, setStep] = createSignal(1);
    const [name, setName] = createSignal('');
    const [isRecording, setIsRecording] = createSignal(false);
    const [recordingProgress, setRecordingProgress] = createSignal(0);
    const [error, setError] = createSignal('');
    const RECORD_DURATION = 30;

    const trainingText = () => TRAINING_TEXTS[props.language] || TRAINING_TEXTS.en;

    const startRecording = async () => {
        setIsRecording(true);
        setRecordingProgress(0);
        try {
            await api.startDictation();

            // Progress timer
            const interval = setInterval(() => {
                setRecordingProgress(prev => {
                    const next = prev + 1;
                    if (next >= RECORD_DURATION) {
                        clearInterval(interval);
                        stopRecording();
                    }
                    return next;
                });
            }, 1000);
        } catch (e) {
            setError(String(e));
            setIsRecording(false);
        }
    };

    const stopRecording = async () => {
        setIsRecording(false);
        try {
            // Get audio and train
            const audio = await api.stopDictationRaw();
            await api.trainSpeaker(name(), audio);
            setStep(3);
        } catch (e) {
            setError(String(e));
        }
    };

    return (
        <div class="voice-training">
            <Show when={step() === 1}>
                <h3>Stap 1: Naam invoeren</h3>
                <input
                    type="text"
                    placeholder="Jouw naam"
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                />
                <button
                    disabled={!name().trim()}
                    onClick={() => setStep(2)}
                >
                    Volgende
                </button>
            </Show>

            <Show when={step() === 2}>
                <h3>Stap 2: Lees de tekst voor</h3>
                <div class="training-text">{trainingText()}</div>
                <Show when={!isRecording()}>
                    <button onClick={startRecording}>Start opname</button>
                </Show>
                <Show when={isRecording()}>
                    <div class="recording-progress">
                        <div class="progress-bar" style={{ width: `${(recordingProgress() / RECORD_DURATION) * 100}%` }} />
                        <span>{recordingProgress()}s / {RECORD_DURATION}s</span>
                    </div>
                </Show>
            </Show>

            <Show when={step() === 3}>
                <h3>Stap 3: Profiel opgeslagen</h3>
                <div class="success-icon">✓</div>
                <p>Stemprofiel voor <strong>{name()}</strong> is opgeslagen.</p>
                <button onClick={props.onComplete}>Sluiten</button>
            </Show>

            <Show when={error()}>
                <p class="error">{error()}</p>
            </Show>

            <button class="cancel" onClick={props.onCancel}>Annuleren</button>
        </div>
    );
}
```

- [ ] **Step 2: Add API bindings**

In `src/lib/api.ts`:

```typescript
async trainSpeaker(name: string, audio: Float32Array): Promise<void> {
    await invoke('train_speaker', { name, audio: Array.from(audio) });
},

async listSpeakerProfiles(): Promise<string[]> {
    return await invoke('list_speaker_profiles') as string[];
},

async deleteSpeakerProfile(name: string): Promise<void> {
    await invoke('delete_speaker_profile', { name });
},

async stopDictationRaw(): Promise<Float32Array> {
    // Returns raw audio data instead of transcribed text
    return await invoke('stop_dictation_raw') as Float32Array;
},
```

- [ ] **Step 3: Add VoiceTraining to SettingsPanel Meeting tab**

```tsx
import VoiceTraining from './VoiceTraining';

// In Meeting tab:
const [showTraining, setShowTraining] = createSignal(false);
const [profiles, setProfiles] = createSignal<string[]>([]);

// Load profiles on mount:
onMount(async () => {
    setProfiles(await api.listSpeakerProfiles());
});

// JSX:
<h4>Stemprofielen</h4>
<For each={profiles()}>
    {(name) => (
        <div class="profile-row">
            <span>{name}</span>
            <span class="trained">✓ Getraind</span>
        </div>
    )}
</For>
<button onClick={() => setShowTraining(true)}>+ Nieuw stemprofiel</button>

<Show when={showTraining()}>
    <VoiceTraining
        language={settings()?.language || 'nl'}
        onComplete={() => {
            setShowTraining(false);
            api.listSpeakerProfiles().then(setProfiles);
        }}
        onCancel={() => setShowTraining(false)}
    />
</Show>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/VoiceTraining.tsx src/components/SettingsPanel.tsx src/lib/api.ts
git commit -m "feat: add voice training wizard with phonetically diverse training texts"
```

---

### Task 18: Auto-correction via llama.cpp

**Files:**
- Create: `src-tauri/src/autocorrect.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create autocorrect.rs**

```rust
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

pub struct AutoCorrector {
    llama_bin: PathBuf,
    model_path: PathBuf,
    use_gpu: bool,
    timeout_secs: u64,
}

impl AutoCorrector {
    pub fn new(model_path: &Path, use_gpu: bool) -> Result<Self, String> {
        let llama_bin = Self::find_llama_binary()?;

        if !model_path.exists() {
            return Err(format!("LLM model not found: {:?}", model_path));
        }

        Ok(Self {
            llama_bin,
            model_path: model_path.to_path_buf(),
            use_gpu,
            timeout_secs: 10,
        })
    }

    fn find_llama_binary() -> Result<PathBuf, String> {
        let names = ["llama-cli", "llama-cli.exe"];
        let search_dirs = [
            std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())),
            std::env::current_exe().ok().and_then(|p| p.parent().and_then(|p| p.parent()).map(|p| p.join("bin"))),
            Some(PathBuf::from("bin")),
        ];

        for dir in search_dirs.iter().flatten() {
            for name in &names {
                let path = dir.join(name);
                if path.exists() {
                    return Ok(path);
                }
            }
        }

        Err("llama-cli binary not found".to_string())
    }

    pub fn correct(&self, text: &str, language: &str) -> Result<String, String> {
        if text.trim().is_empty() {
            return Ok(text.to_string());
        }

        let prompt = match language {
            "nl" => format!(
                "Corrigeer de volgende spraak-naar-tekst transcriptie. Verbeter grammatica en zinsbouw, maar behoud de oorspronkelijke betekenis. Geef alleen de gecorrigeerde tekst terug, zonder uitleg.\n\nTranscriptie: {}\n\nGecorrigeerde tekst:",
                text
            ),
            _ => format!(
                "Correct the following speech-to-text transcription. Fix grammar and sentence structure while preserving the original meaning. Return only the corrected text, no explanation.\n\nTranscription: {}\n\nCorrected text:",
                text
            ),
        };

        let mut child = Command::new(&self.llama_bin)
            .args([
                "-m", &self.model_path.to_string_lossy(),
                "-p", &prompt,
                "-n", "256",
                "--temp", "0.1",
                "--no-display-prompt",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start llama-cli: {}", e))?;

        // Wait with timeout
        let result = std::thread::scope(|s| {
            let handle = s.spawn(|| {
                let mut output = String::new();
                if let Some(mut stdout) = child.stdout.take() {
                    stdout.read_to_string(&mut output).ok();
                }
                output
            });

            std::thread::sleep(Duration::from_secs(self.timeout_secs));

            // Try to kill if still running
            let _ = child.kill();
            handle.join().unwrap_or_default()
        });

        let corrected = result.trim().to_string();
        if corrected.is_empty() {
            Ok(text.to_string())  // Fallback to original if LLM fails
        } else {
            Ok(corrected)
        }
    }
}
```

- [ ] **Step 2: Register module and integrate into post-processing**

In `src-tauri/src/lib.rs`:

```rust
mod autocorrect;

// Add to AppState:
    auto_corrector: Arc<Mutex<Option<autocorrect::AutoCorrector>>>,
```

In the job queue worker (or wherever post-processing happens after transcription), add:

```rust
// After dictionary + spellcheck:
if settings.auto_correct {
    if let Some(ref corrector) = *state.auto_corrector.lock().unwrap() {
        if let Ok(corrected) = corrector.correct(&text, &language) {
            original_text = Some(text.clone());
            text = corrected;
        }
    }
}
```

- [ ] **Step 3: Build and verify**

Run: `cd src-tauri && cargo build 2>&1 | head -30`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/autocorrect.rs src-tauri/src/lib.rs
git commit -m "feat: add local LLM auto-correction via llama.cpp subprocess"
```

---

### Task 19: Integration Testing — Full Flow

**Files:**
- No new files, manual testing

- [ ] **Step 1: Test multi-cursor flow**

1. Start the app with `npm run tauri dev`
2. Open Word and Outlook side by side
3. In Word: press Ctrl+Win, speak for 5s, release
4. Quickly switch to Outlook: press Ctrl+Win, speak for 5s, release
5. Verify: both transcriptions appear in their respective windows

- [ ] **Step 2: Test incremental transcription**

1. Set interval to 3s in Settings
2. Start a long dictation (15s+)
3. Verify: overlay shows progress for each chunk
4. Verify: final text is assembled correctly

- [ ] **Step 3: Test meeting with persistent storage**

1. Start a meeting recording
2. Wait for 2-3 auto-transcribe cycles
3. Check the meeting save directory for .md and .json files
4. Verify: files contain timestamped segments

- [ ] **Step 4: Test retro sounds**

1. Enable retro sound pack in Settings
2. Dictate something
3. Verify: random chiptune sound plays on success
4. Click thumbs-up in overlay
5. Dictate again several times
6. Verify: liked sound appears more often

- [ ] **Step 5: Test overlay**

1. Verify: no flicker when overlay appears
2. Verify: compact pill shape
3. Verify: audio level bar fills 100px width
4. Verify: progress percentage shows during transcription

- [ ] **Step 6: Test floating meeting indicator**

1. Start a meeting recording
2. Verify: small pill appears in top-right
3. Verify: green dot, mic icon, running timer
4. Stop meeting
5. Verify: indicator disappears

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration test fixes for v0.7 features"
```

---

## File Structure Summary

### New files
| File | Purpose |
|------|---------|
| `src-tauri/src/job_queue.rs` | Job queue, worker pool, session management |
| `src-tauri/src/meeting_writer.rs` | Crash-safe incremental meeting file writer |
| `src-tauri/src/speaker.rs` | ONNX speaker embedding, matching, profiles |
| `src-tauri/src/autocorrect.rs` | llama.cpp auto-correction wrapper |
| `src/components/MeetingIndicator.tsx` | Floating meeting status pill |
| `src/components/VoiceTraining.tsx` | 3-step speaker training wizard |
| `scripts/generate-sounds.js` | Chiptune WAV generator |
| `sounds/success/*.wav` | Success sound pool (~8 files) |
| `sounds/start/*.wav` | Recording start sounds (~3 files) |
| `sounds/error/*.wav` | Error sounds (~2 files) |

### Modified files
| File | Changes |
|------|---------|
| `src-tauri/src/lib.rs` | AppState extensions, new commands, job queue integration |
| `src-tauri/src/audio.rs` | (minimal — existing dual buffer already supports the design) |
| `src-tauri/src/transcriber.rs` | Add Clone, progress parsing |
| `src-tauri/src/settings.rs` | New settings fields |
| `src-tauri/Cargo.toml` | Add uuid, chrono, ort dependencies |
| `src-tauri/tauri.conf.json` | Add overlay and indicator window configs |
| `src/App.tsx` | Multi-session recording, job queue polling, indicator show/hide |
| `src/components/DictationOverlay.tsx` | Compact pill redesign, progress bar, thumbs-up |
| `src/components/SettingsPanel.tsx` | New settings sections (transcription, meeting, sounds) |
| `src/components/MeetingRecorder.tsx` | Integration with meeting writer and speaker labels |
| `src/lib/sounds.ts` | WAV playback, preference learning, weighted random |
| `src/lib/api.ts` | New command bindings and interfaces |

### Dependencies added
| Crate/Package | Version | Purpose |
|--------------|---------|---------|
| `uuid` | 1 | Job and session IDs |
| `chrono` | 0.4 | Timestamps for meeting writer |
| `ort` | 2 | ONNX Runtime for speaker embeddings |
