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
import StatusBar from "./components/StatusBar";

const isTauri = !!(window as any).__TAURI_INTERNALS__;

/** Convert Tauri hotkey format to human-readable label */
function formatHotkey(raw: string): string {
  const isMac = navigator.platform?.startsWith("Mac");
  return raw
    .replace(/CmdOrCtrl/gi, isMac ? "Cmd" : "Ctrl")
    .replace(/Super/gi, isMac ? "Cmd" : "Win")
    .replace(/Alt/gi, isMac ? "Option" : "Alt")
    .replace(/\+/g, " + ");
}

type View = "home" | "settings" | "dictionary" | "models" | "mic-test" | "meeting" | "about";

export default function App() {
  const { t, setLocale } = useI18n();
  const [view, setView] = createSignal<View>("home");
  const [settings, setSettings] = createSignal<Settings | null>(null);
  const [isRecording, setIsRecording] = createSignal(false);
  const [isModelLoaded, setIsModelLoaded] = createSignal(false);
  const [transcriptions, setTranscriptions] = createSignal<TranscriptionResult[]>([]);

  const registerHotkey = async (hotkey: string) => {
    if (!isTauri) return;
    try {
      const { register, unregisterAll } = await import("@tauri-apps/plugin-global-shortcut");
      await unregisterAll();
      await register(hotkey, (event) => {
        const mode = settings()?.hotkey_mode || "hold";
        if (mode === "hold") {
          if (event.state === "Pressed") {
            handleStartRecording();
          } else if (event.state === "Released") {
            handleStopRecording();
          }
        } else {
          // Toggle mode: press once to start, press again to stop
          if (event.state === "Pressed") {
            if (isRecording()) {
              handleStopRecording();
            } else {
              handleStartRecording();
            }
          }
        }
      });
      console.log(`Global hotkey registered: ${hotkey}`);
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
            await registerHotkey(s?.hotkey || "Alt+Space");
          } else {
            const { unregisterAll } = await import("@tauri-apps/plugin-global-shortcut");
            await unregisterAll();
          }
        });
      });
    }

    try {
      const s = await api.getSettings();
      console.log("[startup] settings:", JSON.stringify(s));
      if (s.ui_language) setLocale(s.ui_language as Locale);
      setSettings(s);
      await registerHotkey(s.hotkey || "Alt+Space");

      const loaded = await api.isModelLoaded();
      console.log("[startup] isModelLoaded:", loaded, "model_name:", s.model_name, "model_path:", s.model_path);
      if (loaded) {
        setIsModelLoaded(true);
        setStartupMsg(t("app.startupActive", { hotkey: formatHotkey(s.hotkey || "Alt+Space") }));
      } else if (s.model_path) {
        console.log("[startup] backend didn't auto-load, trying from frontend...");
        try {
          await api.loadModel(s.model_path);
          setIsModelLoaded(true);
          console.log("[startup] frontend load succeeded");
          setStartupMsg(t("app.startupModelLoaded", { hotkey: formatHotkey(s.hotkey || "Alt+Space") }));
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
      await api.startRecording();
      setIsRecording(true);
    } catch (e) {
      console.error("Recording error:", e);
    }
  };

  const handleStopRecording = async () => {
    if (!isRecording()) return;

    try {
      const result = await api.stopRecording();
      setIsRecording(false);
      setTranscriptions((prev) => [result, ...prev]);
      const s = settings();
      if (s?.auto_paste && result.text) {
        await api.typeText(result.text);
      }
    } catch (e) {
      setIsRecording(false);
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
            hotkey={formatHotkey(settings()?.hotkey || "Ctrl+Win")}
            modelName={settings()?.model_name || ""}
          />
        </Show>

        <Show when={view() === "mic-test"}>
          <MicTest />
        </Show>

        <Show when={view() === "settings"}>
          <SettingsPanel
            settings={settings()}
            onSave={async (s) => {
              await api.saveSettings(s);
              setSettings(s);
              await registerHotkey(s.hotkey || "Alt+Space");
            }}
          />
        </Show>

        <Show when={view() === "dictionary"}>
          <DictionaryEditor />
        </Show>

        <div style={{ display: view() === "meeting" ? "block" : "none" }}>
          <MeetingRecorder />
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
