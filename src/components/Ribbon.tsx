import { Show } from "solid-js";

type View = "home" | "settings" | "dictionary" | "models" | "mic-test" | "meeting";

interface RibbonProps {
  currentView: View;
  onViewChange: (view: View) => void;
  isRecording: boolean;
  isModelLoaded: boolean;
  modelName: string;
  onRecord: () => void;
}

export default function Ribbon(props: RibbonProps) {
  return (
    <div class="ribbon-container">
      {/* Tabs */}
      <div class="ribbon-tabs">
        <button
          class={`ribbon-tab ${props.currentView === "home" ? "active" : ""}`}
          onClick={() => props.onViewChange("home")}
        >
          Start
        </button>
        <button
          class={`ribbon-tab ${props.currentView === "meeting" ? "active" : ""}`}
          onClick={() => props.onViewChange("meeting")}
        >
          Vergadering
        </button>
        <button
          class={`ribbon-tab ${props.currentView === "mic-test" ? "active" : ""}`}
          onClick={() => props.onViewChange("mic-test")}
        >
          Test
        </button>
        <button
          class={`ribbon-tab ${props.currentView === "models" ? "active" : ""}`}
          onClick={() => props.onViewChange("models")}
        >
          Modellen
        </button>
        <button
          class={`ribbon-tab ${props.currentView === "dictionary" ? "active" : ""}`}
          onClick={() => props.onViewChange("dictionary")}
        >
          Woordenboek
        </button>
        <button
          class={`ribbon-tab ${props.currentView === "settings" ? "active" : ""}`}
          onClick={() => props.onViewChange("settings")}
        >
          Instellingen
        </button>
      </div>

      {/* Content - changes per tab */}
      <div class="ribbon-content-container">
        {/* START tab */}
        <div class={`ribbon-content ${props.currentView === "home" ? "active" : ""}`}>
          <div class="ribbon-groups">
            {/* Dictation group */}
            <div class="ribbon-group">
              <div class="ribbon-group-content">
                <button
                  class={`ribbon-btn ${props.isRecording ? "recording" : ""} ${!props.isModelLoaded ? "disabled" : ""}`}
                  onClick={props.onRecord}
                  disabled={!props.isModelLoaded}
                >
                  <span class="ribbon-btn-icon">
                    <Show when={props.isRecording} fallback={
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                      </svg>
                    }>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                      </svg>
                    </Show>
                  </span>
                  <span class="ribbon-btn-label">
                    {props.isRecording ? "Stop" : "Opnemen"}
                  </span>
                </button>
              </div>
              <div class="ribbon-group-label">Dictatie</div>
            </div>

            {/* Status group */}
            <div class="ribbon-group">
              <div class="ribbon-group-content">
                <div class="ribbon-status">
                  <div
                    class={`ribbon-status-dot ${
                      props.isRecording
                        ? "recording"
                        : props.isModelLoaded
                        ? "ready"
                        : "inactive"
                    }`}
                  />
                  <span>
                    {props.isRecording
                      ? "Opnemen..."
                      : props.isModelLoaded
                      ? "Klaar"
                      : "Geen model"}
                  </span>
                </div>
                <Show when={props.isModelLoaded && props.modelName}>
                  <div class="ribbon-status">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    </svg>
                    <span>{props.modelName}</span>
                  </div>
                </Show>
              </div>
              <div class="ribbon-group-label">Status</div>
            </div>
          </div>
        </div>

        {/* MEETING tab */}
        <div class={`ribbon-content ${props.currentView === "meeting" ? "active" : ""}`}>
          <div class="ribbon-groups">
            <div class="ribbon-group">
              <div class="ribbon-group-content">
                <div class="ribbon-status">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  </svg>
                  <span>Neem vergaderingen op en transcribeer continu</span>
                </div>
              </div>
              <div class="ribbon-group-label">Vergadering</div>
            </div>
          </div>
        </div>

        {/* TEST tab */}
        <div class={`ribbon-content ${props.currentView === "mic-test" ? "active" : ""}`}>
          <div class="ribbon-groups">
            <div class="ribbon-group">
              <div class="ribbon-group-content">
                <div class="ribbon-btn-stack">
                  <button class="ribbon-btn small" onClick={() => props.onViewChange("mic-test")}>
                    <span class="ribbon-btn-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                      </svg>
                    </span>
                    <span class="ribbon-btn-label">Mic Test</span>
                  </button>
                  <button class="ribbon-btn small" onClick={() => props.onViewChange("settings")}>
                    <span class="ribbon-btn-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      </svg>
                    </span>
                    <span class="ribbon-btn-label">Audio Instellingen</span>
                  </button>
                </div>
              </div>
              <div class="ribbon-group-label">Inregelen</div>
            </div>
          </div>
        </div>

        {/* MODELS tab */}
        <div class={`ribbon-content ${props.currentView === "models" ? "active" : ""}`}>
          <div class="ribbon-groups">
            <div class="ribbon-group">
              <div class="ribbon-group-content">
                <div class="ribbon-status">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  </svg>
                  <span>Download en beheer Whisper AI modellen</span>
                </div>
              </div>
              <div class="ribbon-group-label">Spraakmodellen</div>
            </div>
          </div>
        </div>

        {/* DICTIONARY tab */}
        <div class={`ribbon-content ${props.currentView === "dictionary" ? "active" : ""}`}>
          <div class="ribbon-groups">
            <div class="ribbon-group">
              <div class="ribbon-group-content">
                <div class="ribbon-status">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                  <span>Woorden en vervangingen voor spraakherkenning</span>
                </div>
              </div>
              <div class="ribbon-group-label">Woordenboek</div>
            </div>
          </div>
        </div>

        {/* SETTINGS tab */}
        <div class={`ribbon-content ${props.currentView === "settings" ? "active" : ""}`}>
          <div class="ribbon-groups">
            <div class="ribbon-group">
              <div class="ribbon-group-content">
                <div class="ribbon-status">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  <span>Taal, sneltoetsen, audio en weergave</span>
                </div>
              </div>
              <div class="ribbon-group-label">Configuratie</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
