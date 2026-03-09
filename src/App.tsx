import { createSignal, onMount, Show } from "solid-js";
import { api, type Settings, type TranscriptionResult } from "./lib/api";
import Ribbon from "./components/Ribbon";
import TranscriptionView from "./components/TranscriptionView";
import SettingsPanel from "./components/SettingsPanel";
import DictionaryEditor from "./components/DictionaryEditor";
import ModelManager from "./components/ModelManager";
import StatusBar from "./components/StatusBar";

type View = "home" | "settings" | "dictionary" | "models";

export default function App() {
  const [view, setView] = createSignal<View>("home");
  const [settings, setSettings] = createSignal<Settings | null>(null);
  const [isRecording, setIsRecording] = createSignal(false);
  const [isModelLoaded, setIsModelLoaded] = createSignal(false);
  const [transcriptions, setTranscriptions] = createSignal<TranscriptionResult[]>([]);
  const [statusMessage, setStatusMessage] = createSignal("Welkom bij Open Speech Studio");

  onMount(async () => {
    try {
      const s = await api.getSettings();
      setSettings(s);

      // Auto-load model if path is set
      if (s.model_path) {
        setStatusMessage("Model laden...");
        await api.loadModel(s.model_path);
        setIsModelLoaded(true);
        setStatusMessage("Model geladen - Klaar voor dictatie");
      } else {
        setStatusMessage("Geen model geselecteerd - Ga naar Modellen om een model te downloaden");
      }
    } catch (e) {
      console.error("Init error:", e);
      setStatusMessage("Configuratie laden mislukt");
    }
  });

  const handleRecord = async () => {
    if (!isModelLoaded()) {
      setStatusMessage("Laad eerst een model via het Modellen tabblad");
      return;
    }

    if (isRecording()) {
      // Stop recording and transcribe
      setStatusMessage("Transcriberen...");
      try {
        const result = await api.stopRecording();
        setIsRecording(false);
        setTranscriptions((prev) => [result, ...prev]);
        setStatusMessage(
          `Getranscribeerd in ${result.duration_ms}ms - ${result.text.length} tekens`
        );

        // Auto-paste if enabled
        const s = settings();
        if (s?.auto_paste && result.text) {
          await api.typeText(result.text);
        }
      } catch (e) {
        setIsRecording(false);
        setStatusMessage(`Fout: ${e}`);
      }
    } else {
      // Start recording
      try {
        await api.startRecording();
        setIsRecording(true);
        setStatusMessage("Opnemen... Druk nogmaals om te stoppen");
      } catch (e) {
        setStatusMessage(`Fout bij opnemen: ${e}`);
      }
    }
  };

  return (
    <div class="app">
      <Ribbon
        currentView={view()}
        onViewChange={setView}
        isRecording={isRecording()}
        isModelLoaded={isModelLoaded()}
        onRecord={handleRecord}
      />

      <main class="main-content">
        <Show when={view() === "home"}>
          <TranscriptionView
            transcriptions={transcriptions()}
            isRecording={isRecording()}
            isModelLoaded={isModelLoaded()}
            onRecord={handleRecord}
          />
        </Show>

        <Show when={view() === "settings"}>
          <SettingsPanel
            settings={settings()}
            onSave={async (s) => {
              await api.saveSettings(s);
              setSettings(s);
              setStatusMessage("Instellingen opgeslagen");
            }}
          />
        </Show>

        <Show when={view() === "dictionary"}>
          <DictionaryEditor />
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
              setStatusMessage(`Model "${name}" geladen - Klaar voor dictatie`);
            }}
          />
        </Show>
      </main>

      <StatusBar message={statusMessage()} isRecording={isRecording()} />
    </div>
  );
}
