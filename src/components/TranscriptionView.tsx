import type { TranscriptionResult } from "../lib/api";
import { For, Show } from "solid-js";

interface TranscriptionViewProps {
  transcriptions: TranscriptionResult[];
  isRecording: boolean;
  isModelLoaded: boolean;
  onRecord: () => void;
}

export default function TranscriptionView(props: TranscriptionViewProps) {
  return (
    <div class="transcription-view">
      <Show
        when={props.transcriptions.length > 0}
        fallback={
          <div class="empty-state">
            <div class="empty-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <h2>Open Speech Studio</h2>
            <p>
              {props.isModelLoaded
                ? "Druk op de opnameknop of gebruik Ctrl+Shift+Space om te beginnen met dicteren."
                : "Ga naar het Modellen tabblad om een spraakherkenningsmodel te downloaden en te laden."}
            </p>
            <Show when={props.isModelLoaded}>
              <button class="btn btn-primary" onClick={props.onRecord}>
                {props.isRecording ? "Stop opname" : "Start opname"}
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
        <div class="recording-overlay">
          <div class="recording-pulse" />
          <span>Luisteren...</span>
        </div>
      </Show>
    </div>
  );
}
