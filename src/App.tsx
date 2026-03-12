import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { api, type Settings, type TranscriptionResult } from "./lib/api";
import Sidebar from "./components/Sidebar";
import TranscriptionView from "./components/TranscriptionView";
import SettingsPanel from "./components/SettingsPanel";
import DictionaryEditor from "./components/DictionaryEditor";
import ModelManager from "./components/ModelManager";
import MicTest from "./components/MicTest";
import MeetingRecorder from "./components/MeetingRecorder";

const isTauri = !!(window as any).__TAURI_INTERNALS__;

type View = "home" | "settings" | "dictionary" | "models" | "mic-test" | "meeting";

export default function App() {
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
        if (event.state === "Pressed") {
          handleRecord();
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
    try {
      const s = await api.getSettings();
      setSettings(s);
      await registerHotkey(s.hotkey || "CmdOrCtrl+Super");

      const loaded = await api.isModelLoaded();
      if (loaded) {
        setIsModelLoaded(true);
        setStartupMsg(`Open Dictate Studio is actief — druk ${s.hotkey || "Ctrl+Win"} om te dicteren`);
      } else if (s.model_path) {
        try {
          await api.loadModel(s.model_path);
          setIsModelLoaded(true);
          setStartupMsg(`Model geladen — druk ${s.hotkey || "Ctrl+Win"} om te dicteren`);
        } catch {
          setStartupMsg("Ga naar Modellen om een model te laden");
        }
      } else {
        setStartupMsg("Ga naar Modellen om een spraakmodel te downloaden");
      }

      // Auto-hide startup message after 5 seconds
      setTimeout(() => setStartupMsg(null), 5000);
    } catch (e) {
      console.error("Init error:", e);
    }
  });

  const handleRecord = async () => {
    if (!isModelLoaded()) return;

    if (isRecording()) {
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
    } else {
      try {
        await api.startRecording();
        setIsRecording(true);
      } catch (e) {
        console.error("Recording error:", e);
      }
    }
  };

  return (
    <div class="app">
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
            hotkey={settings()?.hotkey || "Ctrl+Win"}
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
              await registerHotkey(s.hotkey || "CmdOrCtrl+Super");
            }}
          />
        </Show>

        <Show when={view() === "dictionary"}>
          <DictionaryEditor />
        </Show>

        <div style={{ display: view() === "meeting" ? "block" : "none" }}>
          <MeetingRecorder />
        </div>

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
  );
}
