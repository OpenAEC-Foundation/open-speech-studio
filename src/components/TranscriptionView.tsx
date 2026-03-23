import type { TranscriptionResult } from "../lib/api";
import { For, Show } from "solid-js";
import { useI18n } from "../lib/i18n";

interface TranscriptionViewProps {
  transcriptions: TranscriptionResult[];
  isRecording: boolean;
  isModelLoaded: boolean;
  onRecord: () => void;
  hotkey: string;
  modelName: string;
}

export default function TranscriptionView(props: TranscriptionViewProps) {
  const { t } = useI18n();
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
                <Show when={result.original_text}>
                  <div class="transcription-original">
                    <span class="original-label">{t("transcription.original")}:</span>
                    <span class="original-text">{result.original_text}</span>
                  </div>
                </Show>
                <div class="transcription-meta">
                  <span class="meta-tag">{result.language || "auto"}</span>
                  <span class="meta-tag">{result.duration_ms}ms</span>
                  <Show when={result.original_text}>
                    <span class="meta-tag spellcheck-tag">{t("transcription.spellChecked")}</span>
                  </Show>
                  <button
                    class="btn btn-small"
                    onClick={() => navigator.clipboard.writeText(result.text)}
                  >
                    {t("transcription.copy")}
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
