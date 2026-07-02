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
import TextToSpeech from "./components/TextToSpeech";
import StatusBar from "./components/StatusBar";
import { soundRecordStart, soundRecordStop, soundTranscriptionDone, soundError, initSounds } from "./lib/sounds";
import { showOverlay, closeOverlay, emitOverlayAudioLevel } from "./lib/overlay";

const isTauri = !!(window as any).__TAURI_INTERNALS__;
// The low-level keyboard hook that owns Win/Super hotkeys exists only on
// Windows. On Linux/macOS the global-shortcut plugin must handle them.
const isWindows = navigator.userAgent.includes("Windows");

// ─── Audio level polling for the overlay's recording bar ──
let audioLevelInterval: ReturnType<typeof setInterval> | null = null;

function startAudioLevelPolling() {
  stopAudioLevelPolling();
  audioLevelInterval = setInterval(async () => {
    try {
      const level = await api.getAudioLevel();
      await emitOverlayAudioLevel(level);
    } catch (_) {}
  }, 80);
}

function stopAudioLevelPolling() {
  if (audioLevelInterval) {
    clearInterval(audioLevelInterval);
    audioLevelInterval = null;
  }
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

type View = "home" | "settings" | "dictionary" | "models" | "mic-test" | "meeting" | "transcribe" | "tts" | "about";

// ─── Transcription time estimator ──────────────────────────
// Models transcription time as a LINEAR function of audio length:
//
//     transcribe_sec = overhead + slope * audio_sec
//
// `overhead` captures fixed cost (spawning whisper-cli, IO) and `slope`
// captures the per-audio-second cost — i.e. how fast THIS machine is.
// A least-squares fit over the last few real runs nails both after ~3
// transcriptions. Seeded defaults are used ONLY when no real samples exist
// yet, so they never pollute the fit. Samples are kept per model name.
const SAMPLES_PREFIX = "oss_samples_";
const MAX_SAMPLES = 12;

// Default per-second slope per model size, used before any real measurement.
const DEFAULT_SLOPE: Record<string, number> = {
  tiny: 0.15, base: 0.25, small: 0.5,
  medium: 1.0, "large-v3-turbo": 0.9, "large-v3": 1.8,
};
const DEFAULT_OVERHEAD = 0.4; // seconds

function samplesKey(model: string): string {
  return SAMPLES_PREFIX + (model || "unknown");
}

function loadSamples(model: string): [number, number][] {
  try {
    const raw = localStorage.getItem(samplesKey(model));
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (_) {}
  return [];
}

function defaultSlope(model: string): number {
  for (const [key, val] of Object.entries(DEFAULT_SLOPE)) {
    if (model.includes(key)) return val;
  }
  return 0.4;
}

/** Record one (audioSeconds, transcribeSeconds) observation for this model. */
function updateEstimate(model: string, recordingMs: number, transcriptionMs: number) {
  const audioSec = Math.max(0.2, recordingMs / 1000);
  const transSec = Math.max(0.05, transcriptionMs / 1000);
  const samples = loadSamples(model);
  samples.push([audioSec, transSec]);
  localStorage.setItem(samplesKey(model), JSON.stringify(samples.slice(-MAX_SAMPLES)));
}

/** Predict transcription seconds for a recording of the given length. */
function getEstimatedSeconds(model: string, recordingMs: number): number {
  const audioSec = Math.max(0.2, recordingMs / 1000);
  const samples = loadSamples(model);

  let overhead: number;
  let slope: number;

  if (samples.length >= 2) {
    // Least-squares linear fit: trans = overhead + slope * audio
    const n = samples.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, y] of samples) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) > 1e-6) {
      slope = (n * sxy - sx * sy) / denom;
      overhead = (sy - slope * sx) / n;
    } else {
      // All clips ~same length — fit through origin (mean ratio)
      slope = sy / sx;
      overhead = 0;
    }
    if (!isFinite(slope) || slope <= 0) slope = defaultSlope(model);
    if (!isFinite(overhead) || overhead < 0) overhead = 0;
  } else if (samples.length === 1) {
    // One point: assume a small fixed overhead, derive slope from it
    overhead = Math.min(DEFAULT_OVERHEAD, samples[0][1] * 0.3);
    slope = Math.max(0.05, (samples[0][1] - overhead) / samples[0][0]);
  } else {
    overhead = DEFAULT_OVERHEAD;
    slope = defaultSlope(model);
  }

  return Math.max(1, Math.round(overhead + slope * audioSec));
}

export default function App() {
  const { t, setLocale } = useI18n();
  const [view, setView] = createSignal<View>("home");
  const [settings, setSettings] = createSignal<Settings | null>(null);
  const [isRecording, setIsRecording] = createSignal(false);
  const [isModelLoaded, setIsModelLoaded] = createSignal(false);
  const [transcriptions, setTranscriptions] = createSignal<TranscriptionResult[]>([]);
  let recordingStartedAt = 0;
  // activeSessions and completionPollInterval reserved for future live streaming (stap 2)

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

      // On Windows, hotkeys with the Win/Super key are owned EXCLUSIVELY by
      // the Rust low-level keyboard hook (ctrl-win-pressed/released events) —
      // registering them with the plugin too causes duplicate/late events.
      // On Linux/macOS there is no such hook, so the plugin MUST register them.
      if (!isWindows || !/super/i.test(hotkey)) {
        await register(hotkey, hotkeyHandler);
        console.log(`Global hotkey registered: ${hotkey}`);
      } else {
        console.log(`Hotkey ${hotkey} handled by keyboard hook only`);
      }

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

  let startLock = false;
  let stopLock = false;

  const handleStartRecording = async () => {
    if (!isModelLoaded()) {
      sendNotification("Open Speech Studio", t("app.noModelNotification"));
      return;
    }
    // Never start while already recording, while a start is in flight,
    // or while the previous transcription is still finishing.
    if (isRecording() || startLock || stopLock) return;
    startLock = true;

    try {
      await api.startDictation();
      recordingStartedAt = Date.now();
      setIsRecording(true);
      if (settings()?.audio_feedback !== false) soundRecordStart();
      await showOverlay({ state: "recording" });
      startAudioLevelPolling();
    } catch (e) {
      console.error("Recording error:", e);
    }
    startLock = false;
  };

  const handleStopRecording = async () => {
    if (stopLock) return;
    // A very fast press-release can arrive while the start is still in
    // flight — wait for it to finish instead of dropping the stop.
    for (let i = 0; i < 40 && startLock; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!isRecording() || stopLock) return;
    stopLock = true;

    stopAudioLevelPolling();
    setIsRecording(false);
    // Distinct "stop" cue when the keys are released (start of processing).
    // The start/stop locks above guarantee this fires exactly once.
    if (settings()?.audio_feedback !== false) soundRecordStop();

    // Predict transcription duration from the learned per-model ratio.
    // The overlay animates its own progress bar from this single estimate.
    const recordingMs = Date.now() - recordingStartedAt;
    const modelName = settings()?.model_name || "";
    const estimatedMs = Math.max(1000, getEstimatedSeconds(modelName, recordingMs) * 1000);
    const transcribeStart = Date.now();

    try {
      await showOverlay({ state: "transcribing", estimatedMs });

      const result = await api.stopDictationSync();

      // Learn from this run: actual transcription time vs recording length
      updateEstimate(modelName, recordingMs, Date.now() - transcribeStart);

      const finalText = result.text?.trim() || '';

      if (finalText && settings()?.auto_paste) {
        await api.typeText(finalText, settings()?.auto_enter === true);
      }

      setTranscriptions(prev => [{
        text: finalText,
        original_text: result.original_text,
        language: result.language || settings()?.language || 'nl',
        duration_ms: result.duration_ms || 0,
      }, ...prev]);

      if (settings()?.audio_feedback !== false) soundTranscriptionDone();
      await showOverlay({ state: "done", text: finalText.substring(0, 50) });
      closeOverlay(2200);
    } catch (e) {
      // Ignore "Not dictating" — benign race between keyboard hook and global shortcut
      const msg = String(e);
      if (!msg.includes("Not dictating")) {
        if (settings()?.audio_feedback !== false) soundError();
        await showOverlay({ state: "error", text: msg });
        closeOverlay(3200);
      }
      console.error("Transcription error:", e);
    }
    stopLock = false;
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

        <Show when={view() === "tts"}>
          <TextToSpeech settings={settings()} />
        </Show>

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
