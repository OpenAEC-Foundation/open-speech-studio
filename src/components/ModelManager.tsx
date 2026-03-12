import { createSignal, onMount, For } from "solid-js";
import { api, type ModelInfo } from "../lib/api";

const isTauri = !!(window as any).__TAURI_INTERNALS__;

const LANGUAGES = [
  { value: "auto", label: "Automatisch detecteren" },
  { value: "nl", label: "Nederlands" },
  { value: "en", label: "Engels" },
  { value: "de", label: "Duits" },
  { value: "fr", label: "Frans" },
  { value: "es", label: "Spaans" },
  { value: "it", label: "Italiaans" },
  { value: "pt", label: "Portugees" },
  { value: "pl", label: "Pools" },
  { value: "ja", label: "Japans" },
  { value: "zh", label: "Chinees" },
  { value: "ru", label: "Russisch" },
  { value: "uk", label: "Oekraïens" },
  { value: "tr", label: "Turks" },
  { value: "ar", label: "Arabisch" },
  { value: "ko", label: "Koreaans" },
];

interface ModelManagerProps {
  onModelLoaded: (path: string, name: string) => void;
  language: string;
  onLanguageChange: (lang: string) => void;
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

    if (isTauri) {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        listen("model-download-complete", () => {
          setDownloading(null);
          refreshModels();
        });
      } catch (_) {}
    }
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

  const getModelInfo = (name: string) => {
    const info: Record<string, { desc: string; speed: string; accuracy: string; ram: string; languages: string }> = {
      tiny: {
        desc: "Kleinste en snelste model. Geschikt voor snelle dictatie waar snelheid belangrijker is dan nauwkeurigheid.",
        speed: "~10x realtime",
        accuracy: "Basis",
        ram: "~1 GB",
        languages: "99 talen",
      },
      base: {
        desc: "Goede balans tussen snelheid en nauwkeurigheid. Aanbevolen startpunt voor de meeste gebruikers op CPU.",
        speed: "~7x realtime",
        accuracy: "Goed",
        ram: "~1 GB",
        languages: "99 talen",
      },
      small: {
        desc: "Merkbaar betere herkenning, vooral bij accenten en vaktaal. Ideaal met GPU of snelle CPU.",
        speed: "~4x realtime",
        accuracy: "Hoog",
        ram: "~2 GB",
        languages: "99 talen",
      },
      medium: {
        desc: "Hoge nauwkeurigheid voor professionele transcriptie. GPU sterk aanbevolen.",
        speed: "~2x realtime",
        accuracy: "Zeer hoog",
        ram: "~5 GB",
        languages: "99 talen",
      },
      "large-v3-turbo": {
        desc: "Nagenoeg beste nauwkeurigheid, maar 2x sneller dan large-v3. Beste keuze voor GPU-gebruikers.",
        speed: "~1.5x realtime",
        accuracy: "Uitstekend",
        ram: "~6 GB",
        languages: "99 talen",
      },
      "large-v3": {
        desc: "Het beste en meest nauwkeurige Whisper model. Vereist krachtige GPU (6+ GB VRAM).",
        speed: "~1x realtime",
        accuracy: "Beste",
        ram: "~10 GB",
        languages: "99 talen",
      },
    };
    return info[name] || { desc: "", speed: "?", accuracy: "?", ram: "?", languages: "?" };
  };

  return (
    <div class="model-manager">
      <h2>Spraakmodellen</h2>
      <p class="section-description">
        Download en laad een Whisper spraakherkenningsmodel. Grotere modellen zijn
        nauwkeuriger maar langzamer. Alle modellen draaien 100% lokaal op uw computer —
        er wordt geen audio naar het internet verstuurd.
      </p>

      {/* Language selector */}
      <div class="model-language-row">
        <label>Herkenningstaal</label>
        <select
          value={props.language}
          onChange={(e) => props.onLanguageChange(e.currentTarget.value)}
        >
          <For each={LANGUAGES}>
            {(lang) => <option value={lang.value}>{lang.label}</option>}
          </For>
        </select>
        <span class="setting-hint">
          {props.language === "auto"
            ? "Whisper detecteert automatisch de gesproken taal"
            : `Whisper zal alleen ${LANGUAGES.find((l) => l.value === props.language)?.label || props.language} herkennen`}
        </span>
      </div>

      {statusMsg() && <div class="status-msg">{statusMsg()}</div>}

      <div class="model-grid">
        <For each={models()}>
          {(model) => {
            const info = getModelInfo(model.name);
            return (
              <div class={`model-card ${model.downloaded ? "downloaded" : ""}`}>
                <div class="model-info">
                  <div class="model-header">
                    <h3>{model.name}</h3>
                    <span class="model-size">{model.size}</span>
                  </div>
                  <p class="model-desc">{info.desc}</p>
                  <div class="model-specs">
                    <div class="model-spec">
                      <span class="model-spec-label">Snelheid</span>
                      <span class="model-spec-value">{info.speed}</span>
                    </div>
                    <div class="model-spec">
                      <span class="model-spec-label">Nauwkeurigheid</span>
                      <span class="model-spec-value">{info.accuracy}</span>
                    </div>
                    <div class="model-spec">
                      <span class="model-spec-label">RAM</span>
                      <span class="model-spec-value">{info.ram}</span>
                    </div>
                    <div class="model-spec">
                      <span class="model-spec-label">Talen</span>
                      <span class="model-spec-value">{info.languages}</span>
                    </div>
                  </div>
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
            );
          }}
        </For>
      </div>
    </div>
  );
}
