import { api, type TranscriptionResult } from "../lib/api";
import { createSignal, For, Show } from "solid-js";
import { useI18n } from "../lib/i18n";

interface TranscriptionViewProps {
  transcriptions: TranscriptionResult[];
  isRecording: boolean;
  isModelLoaded: boolean;
  onRecord: () => void;
  hotkey: string;
  modelName: string;
}

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

function stopSpeak() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

/** Synthesize and play text. Resolves when playback finishes or is stopped. */
async function speakText(text: string): Promise<void> {
  stopSpeak();
  // Uses the voice configured on the Text-to-Speech page (default if unset).
  const audioBytes = await api.ttsSpeak(text);
  const blob = new Blob([new Uint8Array(audioBytes)], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  currentUrl = url;
  const audio = new Audio(url);
  currentAudio = audio;
  await new Promise<void>((resolve) => {
    audio.onended = () => { stopSpeak(); resolve(); };
    audio.onerror = () => { stopSpeak(); resolve(); };
    audio.play().catch(() => { stopSpeak(); resolve(); });
  });
}

export default function TranscriptionView(props: TranscriptionViewProps) {
  const { t } = useI18n();
  const [speakingIdx, setSpeakingIdx] = createSignal<number | null>(null);
  return (
    <div class="home-view">
      <Show
        when={props.transcriptions.length > 0}
        fallback={
          <div class="empty-state">
            <div class="empty-icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <h2>{t("transcription.readyTitle")}</h2>
            <p>
              {props.isModelLoaded
                ? t("transcription.readyDescription")
                : t("transcription.noModelDescription")}
            </p>
            <Show when={props.isModelLoaded}>
              <div class="hotkey-badge">
                {t("transcription.hotkeyHint", { hotkey: props.hotkey || "Ctrl + Win  /  Ctrl + Shift + Space" })}
              </div>
            </Show>
            <Show when={!props.isModelLoaded}>
              <button class="btn btn-primary btn-large" onClick={props.onRecord} disabled>
                {t("transcription.modelRequired")}
              </button>
            </Show>
          </div>
        }
      >
        <div class="transcription-list">
          <For each={props.transcriptions}>
            {(result) => (
              <div class="transcription-item">
                <div class="transcription-text">{result.text}</div>
                <div class="transcription-meta">
                  <span class="meta-tag">{result.language || "auto"}</span>
                  <span class="meta-tag">{result.duration_ms}ms</span>
                  <button
                    class="btn btn-small"
                    onClick={() => navigator.clipboard.writeText(result.text)}
                  >
                    {t("transcription.copy")}
                  </button>
                  <button
                    class="btn btn-small"
                    onClick={async () => {
                      const idx = props.transcriptions.indexOf(result);
                      // Clicking the active row stops playback.
                      if (speakingIdx() === idx) {
                        stopSpeak();
                        setSpeakingIdx(null);
                        return;
                      }
                      try {
                        setSpeakingIdx(idx);
                        await speakText(result.text);
                      } catch (e: any) {
                        console.error("TTS error:", e);
                      } finally {
                        setSpeakingIdx(null);
                      }
                    }}
                    disabled={speakingIdx() !== null && speakingIdx() !== props.transcriptions.indexOf(result)}
                  >
                    {speakingIdx() === props.transcriptions.indexOf(result) ? t("tts.stop") : t("tts.speak")}
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.isRecording}>
        <div class="recording-bar">
          <div class="rec-dot" />
          <span>{t("transcription.listening")}</span>
          <Show when={props.modelName}>
            <span class="recording-model">{props.modelName}</span>
          </Show>
          <button onClick={props.onRecord}>{t("transcription.stop")}</button>
        </div>
      </Show>
    </div>
  );
}
