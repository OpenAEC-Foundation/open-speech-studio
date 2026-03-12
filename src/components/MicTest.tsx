import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { api, type TranscriptionResult } from "../lib/api";

const isTauri = !!(window as any).__TAURI_INTERNALS__;
import { useI18n } from "../lib/i18n";

export default function MicTest() {
  const { t } = useI18n();
  const [devices, setDevices] = createSignal<string[]>([]);
  const [selectedDevice, setSelectedDevice] = createSignal("default");
  const [isTesting, setIsTesting] = createSignal(false);
  const [micLevel, setMicLevel] = createSignal(0);
  const [waveform, setWaveform] = createSignal<number[]>(new Array(40).fill(4));
  const [testResult, setTestResult] = createSignal<TranscriptionResult | null>(null);
  const [status, setStatus] = createSignal<{ type: "info" | "success" | "error"; text: string } | null>(null);
  const [isModelLoaded, setIsModelLoaded] = createSignal(false);
  let animFrame: number | null = null;
  let levelInterval: ReturnType<typeof setInterval> | null = null;
  // Keep a short history of levels for the waveform bars
  let levelHistory: number[] = new Array(40).fill(0);

  onMount(async () => {
    try {
      const devs = await api.getAudioDevices();
      setDevices(devs);
    } catch (e) {
      console.error("Failed to get audio devices:", e);
    }

    try {
      const loaded = await api.isModelLoaded();
      setIsModelLoaded(loaded);
    } catch (_) {}
  });

  onCleanup(() => {
    if (animFrame) cancelAnimationFrame(animFrame);
    if (levelInterval) clearInterval(levelInterval);
  });

  // Poll audio level from Rust backend and update waveform
  const startWaveformAnimation = () => {
    if (isTauri) {
      // Poll the backend for RMS level every 50ms
      levelInterval = setInterval(async () => {
        if (!isTesting()) return;
        try {
          const rms = await api.getAudioLevel();
          // Convert RMS (0.0–1.0) to percentage (amplify for visibility)
          const pct = Math.min(100, rms * 500);
          setMicLevel(pct);
          // Push to history for waveform
          levelHistory.shift();
          levelHistory.push(pct);
          setWaveform(levelHistory.map((v) => 4 + (v / 100) * 60));
        } catch (_) {}
      }, 50);
    } else {
      // Browser fallback: no visualization without mic permission
      setMicLevel(0);
    }
  };

  const stopWaveformAnimation = () => {
    if (animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
    if (levelInterval) {
      clearInterval(levelInterval);
      levelInterval = null;
    }
    levelHistory = new Array(40).fill(0);
    setWaveform(new Array(40).fill(4));
    setMicLevel(0);
  };

  const startTest = async () => {
    setTestResult(null);
    setStatus({ type: "info", text: t("micTest.started") });

    try {
      await api.startRecording();
      setIsTesting(true);
      startWaveformAnimation();
    } catch (e) {
      setStatus({ type: "error", text: t("micTest.micError", { error: String(e) }) });
    }
  };

  const stopTest = async () => {
    stopWaveformAnimation();
    setIsTesting(false);

    if (!isModelLoaded()) {
      setStatus({ type: "info", text: t("micTest.noModel") });
      try {
        await api.stopRecording();
      } catch (_) {}
      return;
    }

    setStatus({ type: "info", text: t("micTest.transcribing") });
    try {
      const result = await api.stopRecording();
      setTestResult(result);

      if (result.text && result.text.trim().length > 0) {
        setStatus({ type: "success", text: t("micTest.success", { duration: result.duration_ms }) });
      } else {
        setStatus({ type: "error", text: t("micTest.noSpeech") });
      }
    } catch (e) {
      setStatus({ type: "error", text: t("micTest.failed", { error: String(e) }) });
    }
  };

  const getLevelClass = () => {
    const level = micLevel();
    if (level < 20) return "low";
    if (level < 70) return "good";
    return "hot";
  };

  return (
    <div class="mic-test">
      <h2>{t("micTest.title")}</h2>
      <p class="section-description">
        {t("micTest.description")}
      </p>

      <div class="mic-test-card">
        <h3>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          </svg>
          {t("micTest.inputDevice")}
        </h3>

        <select
          class="mic-select"
          value={selectedDevice()}
          onChange={(e) => setSelectedDevice(e.target.value)}
        >
          <option value="default">{t("micTest.defaultMic")}</option>
          {devices().map((d) => (
            <option value={d}>{d}</option>
          ))}
        </select>

        {/* Level meter */}
        <div class="mic-level-container">
          <div class="mic-level-label">
            <span>{t("micTest.level")}</span>
            <span>{Math.round(micLevel())}%</span>
          </div>
          <div class="mic-level-bar">
            <div
              class={`mic-level-fill ${getLevelClass()}`}
              style={{ width: `${micLevel()}%` }}
            />
          </div>
        </div>

        {/* Waveform */}
        <div class="mic-waveform">
          {waveform().map((h) => (
            <div class="waveform-bar" style={{ height: `${h}px` }} />
          ))}
        </div>

        {/* Actions */}
        <div class="mic-test-actions">
          <Show
            when={!isTesting()}
            fallback={
              <button class="btn btn-primary btn-large" onClick={stopTest}>
                {t("micTest.stopTest")}
              </button>
            }
          >
            <button class="btn btn-primary btn-large" onClick={startTest}>
              {t("micTest.startTest")}
            </button>
          </Show>
        </div>

        {/* Status */}
        <Show when={status()}>
          {(s) => (
            <div class={`mic-status ${s().type}`}>
              <Show when={s().type === "success"}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </Show>
              <Show when={s().type === "error"}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </Show>
              <Show when={s().type === "info"}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </Show>
              <span>{s().text}</span>
            </div>
          )}
        </Show>
      </div>

      {/* Test result */}
      <Show when={testResult()}>
        {(result) => (
          <div class="mic-test-card">
            <h3>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {t("micTest.result")}
            </h3>
            <div class="mic-test-result">
              <h4>{t("micTest.transcribedText")}</h4>
              <p>{result().text || t("micTest.noTextDetected")}</p>
            </div>
            <div class="transcription-meta" style={{ "margin-top": "12px" }}>
              <span class="meta-tag">{t("micTest.resultLanguage")} {result().language || "auto"}</span>
              <span class="meta-tag">{t("micTest.resultDuration")} {result().duration_ms}ms</span>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
