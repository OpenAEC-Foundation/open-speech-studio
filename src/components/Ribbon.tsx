import { Show } from "solid-js";
import { useI18n } from "../lib/i18n";

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
  const { t } = useI18n();
  return (
    <div class="ribbon-container">
      {/* Tabs */}
      <div class="ribbon-tabs">
        <button
          class={`ribbon-tab ${props.currentView === "home" ? "active" : ""}`}
          onClick={() => props.onViewChange("home")}
        >
          {t("ribbon.start")}
        </button>
        <button
          class={`ribbon-tab ${props.currentView === "meeting" ? "active" : ""}`}
          onClick={() => props.onViewChange("meeting")}
        >
          {t("ribbon.meeting")}
        </button>
        <button
          class={`ribbon-tab ${props.currentView === "mic-test" ? "active" : ""}`}
          onClick={() => props.onViewChange("mic-test")}
        >
          {t("ribbon.test")}
        </button>
        <button
          class={`ribbon-tab ${props.currentView === "models" ? "active" : ""}`}
          onClick={() => props.onViewChange("models")}
        >
          {t("ribbon.models")}
        </button>
        <button
          class={`ribbon-tab ${props.currentView === "dictionary" ? "active" : ""}`}
          onClick={() => props.onViewChange("dictionary")}
        >
          {t("ribbon.dictionary")}
        </button>
        <button
          class={`ribbon-tab ${props.currentView === "settings" ? "active" : ""}`}
          onClick={() => props.onViewChange("settings")}
        >
          {t("ribbon.settings")}
        </button>
      </div>

      {/* Content - changes per tab */}
      <div class="ribbon-content-container">
        {/* START tab */}
        <div class={`ribbon-content ${props.currentView === "home" ? "active" : ""}`}>
          <div class="ribbon-groups">
            {/* Speech group */}
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
                    {props.isRecording ? t("ribbon.stop") : t("ribbon.record")}
                  </span>
                </button>
              </div>
              <div class="ribbon-group-label">{t("ribbon.speech")}</div>
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
                      ? t("ribbon.statusRecording")
                      : props.isModelLoaded
                      ? t("ribbon.statusReady")
                      : t("ribbon.statusNoModel")}
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
              <div class="ribbon-group-label">{t("ribbon.status")}</div>
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
                  <span>{t("ribbon.meetingDescription")}</span>
                </div>
              </div>
              <div class="ribbon-group-label">{t("ribbon.meetingGroup")}</div>
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
                    <span class="ribbon-btn-label">{t("ribbon.micTest")}</span>
                  </button>
                  <button class="ribbon-btn small" onClick={() => props.onViewChange("settings")}>
                    <span class="ribbon-btn-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      </svg>
                    </span>
                    <span class="ribbon-btn-label">{t("ribbon.audioSettings")}</span>
                  </button>
                </div>
              </div>
              <div class="ribbon-group-label">{t("ribbon.calibrate")}</div>
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
                  <span>{t("ribbon.modelsDescription")}</span>
                </div>
              </div>
              <div class="ribbon-group-label">{t("ribbon.speechModels")}</div>
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
                  <span>{t("ribbon.dictionaryDescription")}</span>
                </div>
              </div>
              <div class="ribbon-group-label">{t("ribbon.dictionaryGroup")}</div>
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
                  <span>{t("ribbon.settingsDescription")}</span>
                </div>
              </div>
              <div class="ribbon-group-label">{t("ribbon.configuration")}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
