import { createSignal, onMount, For, Show } from "solid-js";
import { api, type ModelInfo } from "../lib/api";
import { useI18n, getLanguageOptions } from "../lib/i18n";

const isTauri = !!(window as any).__TAURI_INTERNALS__;

interface ModelManagerProps {
  onModelLoaded: (path: string, name: string) => void;
  language: string;
  onLanguageChange: (lang: string) => void;
  activeModel: string;
}

export default function ModelManager(props: ModelManagerProps) {
  const { t } = useI18n();
  const [models, setModels] = createSignal<ModelInfo[]>([]);
  const [downloading, setDownloading] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal<string | null>(null);
  const [statusMsg, setStatusMsg] = createSignal("");
  const [activeModelName, setActiveModelName] = createSignal(props.activeModel);

  onMount(async () => {
    try {
      const m = await api.getAvailableModels();
      setModels(m);
    } catch (e) {
      setStatusMsg(t("models.errorLoading", { error: String(e) }));
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
    setStatusMsg(t("models.downloading", { name }));
    try {
      const path = await api.downloadModel(name);
      setStatusMsg(t("models.loading", { name }));
      await refreshModels();
      // Auto-activate after download
      await api.loadModel(path);
      setActiveModelName(name);
      props.onModelLoaded(path, name);
      setStatusMsg(t("models.loadedReady", { name }));
    } catch (e) {
      setStatusMsg(t("models.downloadFailed", { error: String(e) }));
    }
    setDownloading(null);
  };

  const loadModel = async (model: ModelInfo) => {
    if (!model.path) {
      console.error("loadModel: model.path is null for", model.name);
      setStatusMsg(t("models.loadFailed", { error: "Model path is missing" }));
      return;
    }
    console.log("loadModel: loading", model.name, "from", model.path);
    setLoading(model.name);
    setStatusMsg(t("models.loading", { name: model.name }));
    try {
      await api.loadModel(model.path);
      console.log("loadModel: success for", model.name);
      setActiveModelName(model.name);
      props.onModelLoaded(model.path, model.name);
      setStatusMsg(t("models.loadedReady", { name: model.name }));
    } catch (e) {
      console.error("loadModel: failed for", model.name, e);
      setStatusMsg(t("models.loadFailed", { error: String(e) }));
    }
    setLoading(null);
  };

  const deleteModel = async (name: string) => {
    setLoading(name);
    setStatusMsg(t("models.deleting"));
    try {
      await api.deleteModel(name);
      if (activeModelName() === name) {
        setActiveModelName("");
      }
      await refreshModels();
      setStatusMsg(t("models.deleted", { name }));
    } catch (e) {
      setStatusMsg(t("models.deleteFailed", { error: String(e) }));
    }
    setLoading(null);
  };

  const getModelInfo = (name: string) => {
    const key = name; // "tiny", "base", "small", "medium", "large-v3-turbo", "large-v3"
    return {
      desc: t(`models.${key}.desc`),
      speed: t(`models.${key}.speed`),
      accuracy: t(`models.${key}.accuracy`),
      ram: t(`models.${key}.ram`),
      languages: t(`models.${key}.languages`),
    };
  };

  return (
    <div class="model-manager">
      <h2>{t("models.title")}</h2>
      <p class="section-description">
        {t("models.description")}
      </p>

      {/* Language selector */}
      <div class="model-language-row">
        <label>{t("models.recognitionLanguage")}</label>
        <select
          value={props.language}
          onChange={(e) => props.onLanguageChange(e.currentTarget.value)}
        >
          <For each={getLanguageOptions(t)}>
            {(lang) => <option value={lang.value}>{lang.label}</option>}
          </For>
        </select>
        <span class="setting-hint">
          {props.language === "auto"
            ? t("models.autoDetectHint")
            : t("models.fixedLanguageHint", { language: getLanguageOptions(t).find((l) => l.value === props.language)?.label || props.language })}
        </span>
      </div>

      {statusMsg() && <div class="status-msg">{statusMsg()}</div>}

      <div class="model-grid">
        <For each={models()}>
          {(model) => {
            const info = getModelInfo(model.name);
            return (
              <div class={`model-card ${model.downloaded ? "downloaded" : ""} ${activeModelName() === model.name ? "active" : ""}`}>
                <div class="model-info">
                  <div class="model-header">
                    <h3>{model.name} <Show when={activeModelName() === model.name}><span class="active-badge">{t("models.active")}</span></Show></h3>
                    <span class="model-size">{model.size}</span>
                  </div>
                  <p class="model-desc">{info.desc}</p>
                  <div class="model-specs">
                    <div class="model-spec">
                      <span class="model-spec-label">{t("models.specSpeed")}</span>
                      <span class="model-spec-value">{info.speed}</span>
                    </div>
                    <div class="model-spec">
                      <span class="model-spec-label">{t("models.specAccuracy")}</span>
                      <span class="model-spec-value">{info.accuracy}</span>
                    </div>
                    <div class="model-spec">
                      <span class="model-spec-label">RAM</span>
                      <span class="model-spec-value">{info.ram}</span>
                    </div>
                    <div class="model-spec">
                      <span class="model-spec-label">{t("models.specLanguages")}</span>
                      <span class="model-spec-value">{info.languages}</span>
                    </div>
                  </div>
                </div>
                <div class="model-actions">
                  <Show when={model.downloaded} fallback={
                    <button
                      class="btn btn-secondary"
                      onClick={() => downloadModel(model.name)}
                      disabled={downloading() !== null}
                    >
                      {downloading() === model.name ? t("models.downloadingBtn") : t("models.download")}
                    </button>
                  }>
                    <Show when={activeModelName() === model.name} fallback={
                      <button
                        class="btn btn-primary"
                        onClick={() => loadModel(model)}
                        disabled={loading() === model.name}
                      >
                        {loading() === model.name ? t("models.activating") : t("models.activate")}
                      </button>
                    }>
                      <button class="btn btn-success" disabled>
                        {t("models.active")}
                      </button>
                    </Show>
                    <button
                      class="btn btn-danger-text"
                      onClick={() => deleteModel(model.name)}
                      disabled={loading() !== null || downloading() !== null}
                    >
                      {t("models.delete")}
                    </button>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
