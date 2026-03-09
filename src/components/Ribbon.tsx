interface RibbonProps {
  currentView: string;
  onViewChange: (view: "home" | "settings" | "dictionary" | "models") => void;
  isRecording: boolean;
  isModelLoaded: boolean;
  onRecord: () => void;
}

export default function Ribbon(props: RibbonProps) {
  return (
    <div class="ribbon">
      <div class="ribbon-tabs">
        <button
          class={`ribbon-tab ${props.currentView === "home" ? "active" : ""}`}
          onClick={() => props.onViewChange("home")}
        >
          Start
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

      <div class="ribbon-toolbar">
        <div class="ribbon-group">
          <span class="ribbon-group-label">Dictatie</span>
          <button
            class={`ribbon-btn record-btn ${props.isRecording ? "recording" : ""}`}
            onClick={props.onRecord}
            disabled={!props.isModelLoaded}
            title={props.isModelLoaded ? "Start/stop opname (Ctrl+Shift+Space)" : "Laad eerst een model"}
          >
            <div class="record-icon">
              {props.isRecording ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="8" />
                </svg>
              )}
            </div>
            <span>{props.isRecording ? "Stop" : "Opnemen"}</span>
          </button>
        </div>

        <div class="ribbon-separator" />

        <div class="ribbon-group">
          <span class="ribbon-group-label">Status</span>
          <div class="status-indicator">
            <div
              class={`status-dot ${
                props.isRecording
                  ? "status-recording"
                  : props.isModelLoaded
                  ? "status-ready"
                  : "status-inactive"
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
        </div>
      </div>
    </div>
  );
}
