import type { TranscriptionResult } from "../lib/api";
import { For, Show } from "solid-js";

interface TranscriptionViewProps {
  transcriptions: TranscriptionResult[];
  isRecording: boolean;
  isModelLoaded: boolean;
  onRecord: () => void;
  hotkey: string;
  modelName: string;
}

export default function TranscriptionView(props: TranscriptionViewProps) {
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
            <h2>Klaar om te dicteren</h2>
            <p>
              {props.isModelLoaded
                ? "Druk op de sneltoets om te beginnen. Je stem wordt lokaal verwerkt — niets verlaat je computer."
                : "Ga naar Modellen om een spraakherkenningsmodel te downloaden en te laden."}
            </p>
            <Show when={props.isModelLoaded}>
              <div class="hotkey-badge">
                Druk <kbd>{props.hotkey || "Ctrl+Win"}</kbd> om te starten
              </div>
            </Show>
            <Show when={!props.isModelLoaded}>
              <button class="btn btn-primary btn-large" onClick={props.onRecord} disabled>
                Model vereist
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
                    Kopieer
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
          <span>Luisteren...</span>
          <Show when={props.modelName}>
            <span class="recording-model">{props.modelName}</span>
          </Show>
          <button onClick={props.onRecord}>Stop</button>
        </div>
      </Show>
    </div>
  );
}
