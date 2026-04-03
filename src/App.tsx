import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { api, type Settings, type TranscriptionResult } from "./lib/api";
import { useI18n, type Locale } from "./lib/i18n";
import Sidebar from "./components/Sidebar";
import TranscriptionView from "./components/TranscriptionView";
import SettingsPanel from "./components/SettingsPanel";
import DictionaryEditor from "./components/DictionaryEditor";
import ModelManager from "./components/ModelManager";
import MicTest from "./components/MicTest";
import MeetingRecorder from "./components/MeetingRecorder";
import TitleBar from "./components/TitleBar";
import About from "./components/About";
import FileTranscriber from "./components/FileTranscriber";
import StatusBar from "./components/StatusBar";
import { soundRecordStart, soundRecordStop, soundTranscriptionDone, soundError, initSounds } from "./lib/sounds";

const isTauri = !!(window as any).__TAURI_INTERNALS__;

// ─── Dictation overlay window ─────────────────────────────
let overlayWindow: any = null;
let audioLevelInterval: ReturnType<typeof setInterval> | null = null;

function startAudioLevelPolling() {
  stopAudioLevelPolling();
  audioLevelInterval = setInterval(async () => {
    try {
      const level = await api.getAudioLevel();
      const { emit } = await import("@tauri-apps/api/event");
      await emit("overlay-audio-level", level);
    } catch (_) {}
  }, 80);
}

function stopAudioLevelPolling() {
  if (audioLevelInterval) {
    clearInterval(audioLevelInterval);
    audioLevelInterval = null;
  }
}

async function showOverlay(state: string, text?: string) {
  if (!isTauri) return;
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const { emit } = await import("@tauri-apps/api/event");

    let win = await WebviewWindow.getByLabel("dictation-overlay");
    if (!win) {
      const { currentMonitor } = await import("@tauri-apps/api/window");
      const monitor = await currentMonitor();
      const screenW = monitor?.size?.width ?? 1920;
      const screenH = monitor?.size?.height ?? 1080;
      const scale = monitor?.scaleFactor ?? 1;
      const overlayW = 200;
      const overlayH = 48;
      const margin = 16;

      win = new WebviewWindow("dictation-overlay", {
        url: "/?overlay=true",
        title: "Dictation",
        width: overlayW,
        height: overlayH,
        x: Math.round(screenW / scale) - overlayW - margin,
        y: Math.round(screenH / scale) - overlayH - margin - 48,
        decorations: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        transparent: true,
        focus: false,
        visible: false,
      });

      overlayWindow = win;

      // Wait for the webview to finish loading before sending events
      await new Promise<void>((resolve) => {
        win!.once("tauri://window-created", () => resolve());
        // Fallback timeout in case the event is missed
        setTimeout(resolve, 400);
      });
    } else {
      overlayWindow = win;
    }

    await emit("overlay-state", state);
    if (text) await emit("overlay-text", text);
    await overlayWindow.show();
  } catch (e) {
    console.error("Overlay error:", e);
  }
}

async function closeOverlay() {
  if (!isTauri) return;
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = await WebviewWindow.getByLabel("dictation-overlay");
    if (win) {
      await win.hide();
    }
  } catch (_) {}
}

async function showMeetingIndicator(settingsGetter: () => { floating_indicator?: boolean } | null) {
  if (!isTauri) return;
  if (!settingsGetter()?.floating_indicator) return;
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const { currentMonitor } = await import("@tauri-apps/api/window");

    let indicator = await WebviewWindow.getByLabel("meeting-indicator");
    if (!indicator) {
      indicator = new WebviewWindow("meeting-indicator", {
        url: "/?meeting-indicator=true",
        width: 140, height: 32,
        resizable: false, decorations: false,
        transparent: true, alwaysOnTop: true,
        skipTaskbar: true, visible: false,
      });
    }
    const monitor = await currentMonitor();
    if (monitor) {
      const { PhysicalPosition } = await import("@tauri-apps/api/window");
      await indicator.setPosition(new PhysicalPosition(monitor.size.width - 160, 16));
    }
    await indicator.show();
  } catch (e) {
    console.error("Meeting indicator error:", e);
  }
}

async function hideMeetingIndicator() {
  if (!isTauri) return;
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const indicator = await WebviewWindow.getByLabel("meeting-indicator");
    if (indicator) await indicator.hide();
  } catch (_) {}
}

/** Convert Tauri hotkey format to human-readable label */
function formatHotkey(raw: string): string {
  const isMac = navigator.platform?.startsWith("Mac");
  return raw
    .replace(/CmdOrCtrl/gi, isMac ? "Cmd" : "Ctrl")
    .replace(/Super/gi, isMac ? "Cmd" : "Win")
    .replace(/Alt/gi, isMac ? "Option" : "Alt")
    .replace(/\+/g, " + ");
}

/** Show both available hotkey combos */
function formatBothHotkeys(): string {
  return "Ctrl + Win  /  Ctrl + Shift + Space";
}

type View = "home" | "settings" | "dictionary" | "models" | "mic-test" | "meeting" | "transcribe" | "about";

// ─── Transcription time estimator ──────────────────────────
// Per-model ratio tracking: transcription_time / recording_duration.
// Stored per model name so switching models doesn't pollute the estimate.
const ESTIMATE_PREFIX = "oss_ratio_";

// Sensible defaults per model size (transcribe_time / audio_time).
// These are conservative — actual measurements quickly replace them.
const MODEL_DEFAULTS: Record<string, number> = {
  tiny: 0.15, base: 0.25, small: 0.5,
  medium: 1.0, "large-v3": 1.8, "large-v3-turbo": 0.9,
};

function getRatioKey(model: string): string {
  return ESTIMATE_PREFIX + (model || "unknown");
}

function getModelRatio(model: string): number {
  const stored = parseFloat(localStorage.getItem(getRatioKey(model)) || "0");
  if (stored > 0) return stored;
  // Fallback to default for this model size
  for (const [key, val] of Object.entries(MODEL_DEFAULTS)) {
    if (model.includes(key)) return val;
  }
  return 0.3; // Generic fallback
}

function updateEstimate(model: string, recordingMs: number, transcriptionMs: number) {
  const newRatio = transcriptionMs / Math.max(recordingMs, 500);
  const prev = getModelRatio(model);
  // Exponential moving average — weight new observation 40% for faster convergence
  const ratio = prev > 0 ? prev * 0.6 + newRatio * 0.4 : newRatio;
  localStorage.setItem(getRatioKey(model), ratio.toFixed(4));
}

function getEstimatedSeconds(model: string, recordingMs: number): number {
  const ratio = getModelRatio(model);
  return Math.max(1, Math.round((recordingMs * ratio) / 1000));
}

export default function App() {
  const { t, setLocale } = useI18n();
  const [view, setView] = createSignal<View>("home");
  const [settings, setSettings] = createSignal<Settings | null>(null);
  const [isRecording, setIsRecording] = createSignal(false);
  const [isModelLoaded, setIsModelLoaded] = createSignal(false);
  const [transcriptions, setTranscriptions] = createSignal<TranscriptionResult[]>([]);
  let recordingStartedAt = 0;
  const [activeSessions, setActiveSessions] = createSignal<Map<string, string>>(new Map());
  let completionPollInterval: number | undefined;

  /** All hotkeys that trigger recording (primary + secondary) */
  const SECONDARY_HOTKEY = "Ctrl+Shift+Space";

  const hotkeyHandler = (event: any) => {
    const mode = settings()?.hotkey_mode || "hold";
    if (mode === "hold") {
      if (event.state === "Pressed") {
        handleStartRecording();
      } else if (event.state === "Released") {
        handleStopRecording();
      }
    } else {
      if (event.state === "Pressed") {
        if (isRecording()) {
          handleStopRecording();
        } else {
          handleStartRecording();
        }
      }
    }
  };

  const registerHotkey = async (hotkey: string) => {
    if (!isTauri) return;
    try {
      const { register, unregisterAll } = await import("@tauri-apps/plugin-global-shortcut");
      await unregisterAll();
      await register(hotkey, hotkeyHandler);
      console.log(`Global hotkey registered: ${hotkey}`);
      // Also register secondary hotkey
      if (hotkey !== SECONDARY_HOTKEY) {
        try {
          await register(SECONDARY_HOTKEY, hotkeyHandler);
          console.log(`Secondary hotkey registered: ${SECONDARY_HOTKEY}`);
        } catch (e2) {
          console.warn("Failed to register secondary hotkey:", e2);
        }
      }
    } catch (e) {
      console.error("Failed to register hotkey:", e);
    }
  };

  onCleanup(async () => {
    if (completionPollInterval) {
      clearInterval(completionPollInterval);
      completionPollInterval = undefined;
    }
    if (!isTauri) return;
    try {
      const { unregisterAll } = await import("@tauri-apps/plugin-global-shortcut");
      await unregisterAll();
    } catch (_) {}
  });

  const [startupMsg, setStartupMsg] = createSignal<string | null>(null);

  onMount(async () => {
    // Unlock audio context early so global hotkeys can produce sound
    initSounds();
    document.addEventListener("click", initSounds, { once: true });
    document.addEventListener("keydown", initSounds, { once: true });

    // Show the window once the frontend is rendered (avoids white flash)
    if (isTauri) {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        getCurrentWindow().show();
      });

      // Toggle hotkey when enabled/disabled via tray menu
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen<boolean>("app-enabled-changed", async (event) => {
          if (event.payload) {
            const s = settings();
            await registerHotkey(s?.hotkey || "Ctrl+Super");
          } else {
            const { unregisterAll } = await import("@tauri-apps/plugin-global-shortcut");
            await unregisterAll();
          }
        });

        // Ctrl+Win via low-level keyboard hook (Rust backend)
        listen<void>("ctrl-win-pressed", () => {
          handleStartRecording();
        });
        listen<void>("ctrl-win-released", () => {
          handleStopRecording();
        });
      });
    }

    try {
      const s = await api.getSettings();
      console.log("[startup] settings:", JSON.stringify(s));
      if (s.ui_language) setLocale(s.ui_language as Locale);
      setSettings(s);
      await registerHotkey(s.hotkey || "Ctrl+Super");

      const loaded = await api.isModelLoaded();
      console.log("[startup] isModelLoaded:", loaded, "model_name:", s.model_name, "model_path:", s.model_path);
      if (loaded) {
        setIsModelLoaded(true);
        await api.initJobQueue();
        setStartupMsg(t("app.startupActive", { hotkey: formatBothHotkeys() }));
      } else if (s.model_path) {
        console.log("[startup] backend didn't auto-load, trying from frontend...");
        try {
          await api.loadModel(s.model_path);
          setIsModelLoaded(true);
          await api.initJobQueue();
          console.log("[startup] frontend load succeeded");
          setStartupMsg(t("app.startupModelLoaded", { hotkey: formatBothHotkeys() }));
        } catch (loadErr) {
          console.error("[startup] frontend load failed:", loadErr);
          setStartupMsg(t("app.startupLoadModel"));
        }
      } else {
        console.log("[startup] no model_path in settings");
        setStartupMsg(t("app.startupDownloadModel"));
      }

      // Auto-hide startup message after 5 seconds
      setTimeout(() => setStartupMsg(null), 5000);
    } catch (e) {
      console.error("Init error:", e);
    }
  });

  const sendNotification = async (title: string, body?: string) => {
    if (!isTauri) return;
    try {
      const { sendNotification: notify } = await import("@tauri-apps/plugin-notification");
      notify({ title, body });
    } catch (_) {}
  };

  // Start polling for chunk results (used during recording AND after stop)
  const startChunkPolling = () => {
    if (!completionPollInterval) {
      completionPollInterval = window.setInterval(pollChunkResults, 300);
    }
  };

  const stopChunkPolling = () => {
    if (completionPollInterval) {
      clearInterval(completionPollInterval);
      completionPollInterval = undefined;
    }
  };

  const handleStartRecording = async () => {
    if (!isModelLoaded()) {
      sendNotification("Open Speech Studio", t("app.noModelNotification"));
      return;
    }
    if (isRecording()) return;

    try {
      const sessionId = await api.startDictation();
      setActiveSessions(prev => {
        const next = new Map(prev);
        next.set(sessionId, 'recording');
        return next;
      });
      recordingStartedAt = Date.now();
      setIsRecording(true);
      if (settings()?.audio_feedback !== false) soundRecordStart();
      await showOverlay("recording");
      startAudioLevelPolling();
      // Start polling immediately so incremental chunks get typed during recording
      startChunkPolling();
    } catch (e) {
      if (settings()?.audio_feedback !== false) soundError();
      console.error("Recording error:", e);
    }
  };

  const handleStopRecording = async () => {
    if (!isRecording()) return;

    stopAudioLevelPolling();
    if (settings()?.audio_feedback !== false) soundRecordStop();

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
    setIsRecording(false);

    try {
      await api.stopDictationAsync(sessionId);
      await showOverlay("transcribing", '');
      // Polling is already running from handleStartRecording
    } catch (e) {
      if (settings()?.audio_feedback !== false) soundError();
      await showOverlay("error", String(e));
      setTimeout(() => closeOverlay(), 3000);
      console.error("Transcription error:", e);
    }
  };

  // Poll for individual chunk results AND completed sessions
  const pollChunkResults = async () => {
    try {
      // 1. Check for individual chunk results (typed immediately during recording)
      const chunks = await api.pollChunkResults();
      for (const [_sessionId, _chunkIdx, text, _hwnd] of chunks) {
        const chunkText = text.trim();
        if (chunkText && settings()?.auto_paste) {
          await api.typeText(chunkText);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        // Add to transcription history
        setTranscriptions(prev => [{
          text: chunkText,
          language: settings()?.language || 'nl',
          duration_ms: 0,
        }, ...prev]);
      }

      // 2. Check for fully completed sessions (cleanup)
      const completed = await api.getCompletedSessions();
      for (const [sessionId, _hwnd, _text] of completed) {
        // Session is done — remove from active, play sound, show done overlay
        setActiveSessions(prev => {
          const next = new Map(prev);
          next.delete(sessionId);
          return next;
        });
        if (settings()?.audio_feedback !== false) soundTranscriptionDone();
        await showOverlay('done', 'Transcriptie voltooid');
        setTimeout(() => closeOverlay(), 2000);
      }

      // Stop polling if nothing is active anymore
      const remaining = activeSessions();
      const hasActive = remaining.size > 0;
      if (!hasActive) {
        stopChunkPolling();
      }
    } catch (err) {
      console.error('Poll error:', err);
    }
  };

  /** Toggle for UI buttons (click to start, click to stop) */
  const handleRecord = async () => {
    if (isRecording()) {
      await handleStopRecording();
    } else {
      await handleStartRecording();
    }
  };

  return (
    <div class="app">
      <TitleBar />
      <div class="app-main">
      <Sidebar
        currentView={view()}
        onViewChange={setView}
        isRecording={isRecording()}
        isModelLoaded={isModelLoaded()}
        modelName={settings()?.model_name || ""}
        onRecord={handleRecord}
      />

      <div class="app-body">
        {/* Startup notification bar */}
        <Show when={startupMsg()}>
          <div class="startup-bar">
            <span>{startupMsg()}</span>
            <button onClick={() => setStartupMsg(null)}>✕</button>
          </div>
        </Show>

        <main class="main-content">
        <Show when={view() === "home"}>
          <TranscriptionView
            transcriptions={transcriptions()}
            isRecording={isRecording()}
            isModelLoaded={isModelLoaded()}
            onRecord={handleRecord}
            hotkey={formatBothHotkeys()}
            modelName={settings()?.model_name || ""}
          />
        </Show>

        <div style={{ display: view() === "transcribe" ? "block" : "none" }}>
          <FileTranscriber />
        </div>

        <Show when={view() === "mic-test"}>
          <MicTest />
        </Show>

        <Show when={view() === "settings"}>
          <SettingsPanel
            settings={settings()}
            onSave={async (s) => {
              await api.saveSettings(s);
              setSettings(s);
              await registerHotkey(s.hotkey || "Ctrl+Super");
            }}
          />
        </Show>

        <Show when={view() === "dictionary"}>
          <DictionaryEditor />
        </Show>

        <div style={{ display: view() === "meeting" ? "block" : "none" }}>
          <MeetingRecorder
            activeModelName={settings()?.model_name || ""}
            audioFeedback={settings()?.audio_feedback !== false}
            onRecordingStart={() => showMeetingIndicator(settings)}
            onRecordingStop={() => hideMeetingIndicator()}
          />
        </div>

        <Show when={view() === "about"}>
          <About />
        </Show>

        <Show when={view() === "models"}>
          <ModelManager
            onModelLoaded={async (path, name) => {
              setIsModelLoaded(true);
              await api.initJobQueue();
              const s = settings();
              if (s) {
                const updated = { ...s, model_path: path, model_name: name };
                setSettings(updated);
                api.saveSettings(updated);
              }
            }}
            activeModel={settings()?.model_name || ""}
            language={settings()?.language || "auto"}
            onLanguageChange={(lang) => {
              const s = settings();
              if (s) {
                const updated = { ...s, language: lang };
                setSettings(updated);
                api.saveSettings(updated);
              }
            }}
          />
        </Show>
      </main>
      </div>
      </div>
      <StatusBar
        isRecording={isRecording()}
        isModelLoaded={isModelLoaded()}
        modelName={settings()?.model_name || ""}
      />
    </div>
  );
}
