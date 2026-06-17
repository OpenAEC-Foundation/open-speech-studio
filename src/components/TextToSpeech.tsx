import { createSignal, onMount, onCleanup, For, Show } from "solid-js";
import { api, type Settings, type PiperVoiceInfo, type TtsOptions } from "../lib/api";
import { useI18n } from "../lib/i18n";

const isTauri = !!(window as any).__TAURI_INTERNALS__;

// Per-voice tuning persisted in localStorage, keyed by voice id.
interface VoiceTuning { speed: number; expressiveness: number; pause: number; }
const TUNING_DEFAULT: VoiceTuning = { speed: 1.0, expressiveness: 0.667, pause: 0.2 };

function loadTuning(voiceId: string): VoiceTuning {
  try {
    const raw = localStorage.getItem(`oss_tts_tune_${voiceId}`);
    if (raw) return { ...TUNING_DEFAULT, ...JSON.parse(raw) };
  } catch (_) {}
  return { ...TUNING_DEFAULT };
}

function saveTuning(voiceId: string, tuning: VoiceTuning) {
  localStorage.setItem(`oss_tts_tune_${voiceId}`, JSON.stringify(tuning));
}

interface TextToSpeechProps {
  settings: Settings | null;
}

let currentAudio: HTMLAudioElement | null = null;

export default function TextToSpeech(props: TextToSpeechProps) {
  const { t } = useI18n();
  const [voices, setVoices] = createSignal<PiperVoiceInfo[]>([]);
  const [selected, setSelected] = createSignal<string>(props.settings?.tts_voice || "");
  const [text, setText] = createSignal("");
  const [speaking, setSpeaking] = createSignal(false);
  const [downloading, setDownloading] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal(0);
  const [progressMb, setProgressMb] = createSignal<{ done: number; total: number } | null>(null);
  const [statusMsg, setStatusMsg] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [tuning, setTuning] = createSignal<VoiceTuning>(loadTuning(props.settings?.tts_voice || ""));

  // Reload tuning whenever the selected voice changes.
  const applyTuning = (patch: Partial<VoiceTuning>) => {
    const next = { ...tuning(), ...patch };
    setTuning(next);
    if (selected()) saveTuning(selected(), next);
  };

  let unlisten: (() => void)[] = [];

  const refresh = async () => {
    try {
      const v = await api.ttsGetVoices();
      setVoices(v);
      // Default selection: keep current if downloaded, else first downloaded voice.
      const cur = v.find((x) => x.id === selected());
      if (!cur || !cur.downloaded) {
        const firstDl = v.find((x) => x.downloaded);
        if (firstDl) setSelected(firstDl.id);
      }
    } catch (_) {}
  };

  const notify = async (title: string, body: string) => {
    if (!isTauri) return;
    try {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      sendNotification({ title, body });
    } catch (_) {}
  };

  onMount(async () => {
    await refresh();
    if (!isTauri) return;
    try {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten.push(await listen<{ pct: number; downloaded_mb: number; total_mb: number }>(
        "tts-download-progress",
        (e) => {
          setProgress(e.payload.pct);
          setProgressMb({ done: e.payload.downloaded_mb, total: e.payload.total_mb });
        }
      ));
    } catch (_) {}
  });

  onCleanup(() => unlisten.forEach((u) => u()));

  const voice = () => voices().find((v) => v.id === selected());

  const handleDownload = async (id: string) => {
    setDownloading(id);
    setProgress(0);
    setProgressMb(null);
    setError(null);
    setStatusMsg(t("tts.downloadingVoice"));
    try {
      await api.ttsDownloadVoice(id);
      setSelected(id);
      if (props.settings) api.saveSettings({ ...props.settings, tts_voice: id });
      await refresh();
      setStatusMsg(t("tts.voiceReady"));
      notify(t("models.notifyDoneTitle"), t("tts.voiceReady"));
    } catch (e: any) {
      setError(e?.message || String(e));
      setStatusMsg("");
    }
    setDownloading(null);
    setProgressMb(null);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.ttsDeleteVoice(id);
      await refresh();
      setStatusMsg(t("tts.voiceDeleted"));
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const handleSpeak = async () => {
    const input = text().trim();
    const v = voice();
    if (!input || !v) return;
    setError(null);
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    setSpeaking(true);
    try {
      const tn = tuning();
      const opts: TtsOptions = {
        speed: tn.speed,
        expressiveness: tn.expressiveness,
        sentencePause: tn.pause,
      };
      const bytes = await api.ttsSpeak(input, v.id, opts);
      const blob = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio = audio;
      audio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; setSpeaking(false); };
      audio.onerror = () => { setSpeaking(false); setError("Audio playback failed"); };
      audio.play();
    } catch (e: any) {
      setSpeaking(false);
      setError(e?.message || String(e));
    }
  };

  const handleStop = () => {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    setSpeaking(false);
  };

  const onSelect = (id: string) => {
    setSelected(id);
    setTuning(loadTuning(id)); // each voice keeps its own settings
    if (props.settings) api.saveSettings({ ...props.settings, tts_voice: id });
  };

  const downloadedVoices = () => voices().filter((v) => v.downloaded);

  return (
    <div class="tts-view">
      <h2>{t("tts.title")}</h2>
      <p class="view-description">{t("tts.descriptionPiper")}</p>

      <Show when={statusMsg()}>
        <div class="status-msg">{statusMsg()}</div>
      </Show>
      <Show when={error()}>
        <div class="tts-error">{error()}</div>
      </Show>

      {/* Speak controls — only when at least one voice is downloaded */}
      <Show when={downloadedVoices().length > 0}>
        <div class="tts-controls">
          <div class="setting-row">
            <label>{t("settings.ttsVoice")}</label>
            <select value={selected()} onChange={(e) => onSelect(e.target.value)}>
              <For each={downloadedVoices()}>
                {(v) => <option value={v.id}>{v.name} — {v.language}</option>}
              </For>
            </select>
          </div>

          {/* Per-voice tuning */}
          <div class="tts-tuning">
            <div class="tts-tuning-row">
              <label>{t("tts.speed")}</label>
              <input type="range" min="0.5" max="2" step="0.05"
                value={tuning().speed}
                onInput={(e) => applyTuning({ speed: parseFloat(e.currentTarget.value) })}
              />
              <span class="tts-tuning-val">{tuning().speed < 1 ? t("tts.faster") : tuning().speed > 1 ? t("tts.slower") : t("tts.normal")}</span>
            </div>
            <div class="tts-tuning-row">
              <label>{t("tts.expressiveness")}</label>
              <input type="range" min="0" max="1" step="0.05"
                value={tuning().expressiveness}
                onInput={(e) => applyTuning({ expressiveness: parseFloat(e.currentTarget.value) })}
              />
              <span class="tts-tuning-val">{Math.round(tuning().expressiveness * 100)}%</span>
            </div>
            <div class="tts-tuning-row">
              <label>{t("tts.sentencePause")}</label>
              <input type="range" min="0" max="1" step="0.05"
                value={tuning().pause}
                onInput={(e) => applyTuning({ pause: parseFloat(e.currentTarget.value) })}
              />
              <span class="tts-tuning-val">{tuning().pause.toFixed(2)}s</span>
            </div>
            <button class="tts-tuning-reset" onClick={() => applyTuning(TUNING_DEFAULT)}>
              {t("tts.resetTuning")}
            </button>
          </div>

          <textarea
            class="tts-input"
            rows={5}
            placeholder={t("tts.inputPlaceholder")}
            value={text()}
            onInput={(e) => setText(e.target.value)}
          />
          <div class="tts-actions">
            <Show when={!speaking()} fallback={
              <button class="btn btn-primary" onClick={handleStop}>{t("tts.stop")}</button>
            }>
              <button class="btn btn-primary" onClick={handleSpeak} disabled={!text().trim()}>
                {t("tts.speakBtn")}
              </button>
            </Show>
          </div>
        </div>
      </Show>

      {/* Voice library */}
      <h3 class="tts-section-title" style={{ "margin-top": "24px" }}>{t("tts.voiceLibrary")}</h3>
      <div class="piper-voice-list">
        <For each={voices()}>
          {(v) => (
            <div class={`piper-voice ${v.downloaded ? "downloaded" : ""} ${selected() === v.id ? "active" : ""}`}>
              <div class="piper-voice-top">
                <div class="piper-voice-info">
                  <div class="piper-voice-name">
                    {v.name}
                    <span class="piper-voice-lang">{v.language}</span>
                    <span class="piper-voice-q">{v.quality}</span>
                  </div>
                  <span class="piper-voice-size">{v.size}</span>
                </div>
                <div class="piper-voice-actions">
                  <Show when={!v.downloaded} fallback={
                    <>
                      <Show when={selected() !== v.id}>
                        <button class="btn btn-small" onClick={() => onSelect(v.id)}>{t("tts.useVoice")}</button>
                      </Show>
                      <Show when={selected() === v.id}>
                        <span class="piper-voice-badge">{t("tts.selected")}</span>
                      </Show>
                      <button class="btn btn-small btn-danger-outline" onClick={() => handleDelete(v.id)}>
                        {t("models.delete")}
                      </button>
                    </>
                  }>
                    <button
                      class="btn btn-small btn-primary"
                      onClick={() => handleDownload(v.id)}
                      disabled={downloading() !== null}
                    >
                      {downloading() === v.id ? `${t("tts.downloadingVoice")} ${progress()}%` : t("models.download")}
                    </button>
                  </Show>
                </div>
              </div>

              {/* Inline download progress for this voice */}
              <Show when={downloading() === v.id}>
                <div class="piper-voice-progress">
                  <div class="download-bar-track">
                    <div class="download-bar-fill" style={{ width: `${progress()}%` }} />
                  </div>
                  <span class="piper-voice-progress-meta">
                    {progressMb() ? `${progressMb()!.done} / ${progressMb()!.total} MB` : t("tts.preparing")}
                  </span>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
