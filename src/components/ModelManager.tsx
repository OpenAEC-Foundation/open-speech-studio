import { createSignal, onMount, For } from "solid-js";
import { api, type ModelInfo } from "../lib/api";
import { listen } from "@tauri-apps/api/event";

interface ModelManagerProps {
  onModelLoaded: (path: string, name: string) => void;
}

export default function ModelManager(props: ModelManagerProps) {
  const [models, setModels] = createSignal<ModelInfo[]>([]);
  const [downloading, setDownloading] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal<string | null>(null);
  const [statusMsg, setStatusMsg] = createSignal("");

  onMount(async () => {
    try {
      const m = await api.getAvailableModels();
      setModels(m);
    } catch (e) {
      setStatusMsg(`Fout bij laden modellen: ${e}`);
    }

    listen("model-download-complete", () => {
      setDownloading(null);
      refreshModels();
    });
  });

  const refreshModels = async () => {
    try {
      const m = await api.getAvailableModels();
      setModels(m);
    } catch (_) {}
  };

  const downloadModel = async (name: string) => {
    setDownloading(name);
    setStatusMsg(`Model "${name}" downloaden...`);
    try {
      await api.downloadModel(name);
      setStatusMsg(`Model "${name}" gedownload`);
      await refreshModels();
    } catch (e) {
      setStatusMsg(`Download mislukt: ${e}`);
    }
    setDownloading(null);
  };

  const loadModel = async (model: ModelInfo) => {
    if (!model.path) return;
    setLoading(model.name);
    setStatusMsg(`Model "${model.name}" laden...`);
    try {
      await api.loadModel(model.path);
      props.onModelLoaded(model.path, model.name);
      setStatusMsg(`Model "${model.name}" geladen en klaar`);
    } catch (e) {
      setStatusMsg(`Laden mislukt: ${e}`);
    }
    setLoading(null);
  };

  const getModelDescription = (name: string): string => {
    const descriptions: Record<string, string> = {
      tiny: "Snelste model, laagste nauwkeurigheid. Goed voor CPU.",
      base: "Goede balans tussen snelheid en nauwkeurigheid. Aanbevolen voor CPU.",
      small: "Betere nauwkeurigheid, iets langzamer. Goed met GPU.",
      medium: "Hoge nauwkeurigheid, vereist GPU voor realtime gebruik.",
      "large-v3": "Beste nauwkeurigheid. Vereist krachtige GPU.",
      "large-v3-turbo": "Bijna beste nauwkeurigheid, 2x sneller dan large-v3.",
    };
    return descriptions[name] || "";
  };

  return (
    <div class="model-manager">
      <h2>Spraakmodellen</h2>
      <p class="section-description">
        Download en laad een Whisper spraakherkenningsmodel. Grotere modellen zijn
        nauwkeuriger maar langzamer. Alle modellen draaien lokaal op uw computer.
      </p>

      {statusMsg() && <div class="status-msg">{statusMsg()}</div>}

      <div class="model-grid">
        <For each={models()}>
          {(model) => (
            <div class={`model-card ${model.downloaded ? "downloaded" : ""}`}>
              <div class="model-info">
                <h3>{model.name}</h3>
                <span class="model-size">{model.size}</span>
                <p class="model-desc">{getModelDescription(model.name)}</p>
              </div>
              <div class="model-actions">
                {model.downloaded ? (
                  <button
                    class="btn btn-primary"
                    onClick={() => loadModel(model)}
                    disabled={loading() === model.name}
                  >
                    {loading() === model.name ? "Laden..." : "Activeren"}
                  </button>
                ) : (
                  <button
                    class="btn btn-secondary"
                    onClick={() => downloadModel(model.name)}
                    disabled={downloading() !== null}
                  >
                    {downloading() === model.name ? "Downloaden..." : "Download"}
                  </button>
                )}
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
