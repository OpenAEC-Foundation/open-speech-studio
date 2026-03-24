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
    const { currentMonitor } = await import("@tauri-apps/api/window");
    const { emit } = await import("@tauri-apps/api/event");

    if (!overlayWindow || (overlayWindow as any).__destroyed) {
      const monitor = await currentMonitor();
      const screenW = monitor?.size?.width ?? 1920;
      const screenH = monitor?.size?.height ?? 1080;
      const scale = monitor?.scaleFactor ?? 1;
      const overlayW = 280;
      const overlayH = 64;
      const margin = 16;

      overlayWindow = new WebviewWindow("dictation-overlay", {
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
      });

      (overlayWindow as any).__destroyed = false;
      overlayWindow.once("tauri://destroyed", () => {
        (overlayWindow as any).__destroyed = true;
      });

      // Small delay to let webview load
      await new Promise((r) => setTimeout(r, 300));
    }

    await emit("overlay-state", state);
    if (text) await emit("overlay-text", text);
  } catch (e) {
    console.error("Overlay error:", e);
  }
}

async function closeOverlay() {
  if (!isTauri || !overlayWindow) return;
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit("overlay-close");
    overlayWindow = null;
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
        setStartupMsg(t("app.startupActive", { hotkey: formatBothHotkeys() }));
      } else if (s.model_path) {
        console.log("[startup] backend didn't auto-load, trying from frontend...");
        try {
          await api.loadModel(s.model_path);
          setIsModelLoaded(true);
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

  const handleStartRecording = async () => {
    if (!isModelLoaded()) {
      sendNotification("Open Speech Studio", t("app.noModelNotification"));
      return;
    }
    if (isRecording()) return;

    try {
      if (settings()?.audio_feedback !== false) soundRecordStart();
      await api.startDictation();
      recordingStartedAt = Date.now();
      setIsRecording(true);
      await showOverlay("recording");
      startAudioLevelPolling();
    } catch (e) {
      if (settings()?.audio_feedback !== false) soundError();
      console.error("Recording error:", e);
    }
  };

  const handleStopRecording = async () => {
    if (!isRecording()) return;

    try {
      if (settings()?.audio_feedback !== false) soundRecordStop();
      stopAudioLevelPolling();
      const recDuration = Date.now() - recordingStartedAt;
      const modelName = settings()?.model_name || "base";
      const estSec = getEstimatedSeconds(modelName, recDuration);
      await showOverlay("transcribing", `~${estSec}s`);
      const transcribeStart = Date.now();
      const result = await api.stopDictation();
      const transcribeDuration = Date.now() - transcribeStart;
      updateEstimate(modelName, recDuration, transcribeDuration);
      setIsRecording(false);
      setTranscriptions((prev) => [result, ...prev]);
      if (settings()?.audio_feedback !== false) soundTranscriptionDone();
      const s = settings();
      if (s?.auto_paste && result.text) {
        await api.typeText(result.text);
      }
      // Show result briefly, then close
      await showOverlay("done", result.text || t("overlay.done"));
      setTimeout(() => closeOverlay(), 2000);
    } catch (e) {
      setIsRecording(false);
      if (settings()?.audio_feedback !== false) soundError();
      await showOverlay("error", String(e));
      setTimeout(() => closeOverlay(), 3000);
      console.error("Transcription error:", e);
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
          <MeetingRecorder activeModelName={settings()?.model_name || ""} audioFeedback={settings()?.audio_feedback !== false} />
        </div>

        <Show when={view() === "about"}>
          <About />
        </Show>

        <Show when={view() === "models"}>
          <ModelManager
            onModelLoaded={(path, name) => {
              setIsModelLoaded(true);
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
