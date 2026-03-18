import { Show } from "solid-js";
import { useI18n } from "../lib/i18n";

type View = "home" | "settings" | "dictionary" | "models" | "mic-test" | "meeting" | "transcribe" | "about";

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
  isRecording: boolean;
  isModelLoaded: boolean;
  modelName: string;
  onRecord: () => void;
}

export default function Sidebar(props: SidebarProps) {
  const { t } = useI18n();
  return (
    <aside class="sidebar">
      <nav class="sidebar-nav">
        <button
          class={`sidebar-item ${props.currentView === "home" ? "active" : ""}`}
          onClick={() => props.onViewChange("home")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
          </svg>
          <span>{t("sidebar.speech")}</span>
        </button>

        <button
          class={`sidebar-item ${props.currentView === "transcribe" ? "active" : ""}`}
          onClick={() => props.onViewChange("transcribe")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span>{t("sidebar.transcribe")}</span>
        </button>

        <button
          class={`sidebar-item ${props.currentView === "meeting" ? "active" : ""}`}
          onClick={() => props.onViewChange("meeting")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span>{t("sidebar.meeting")}</span>
        </button>

        <button
          class={`sidebar-item ${props.currentView === "mic-test" ? "active" : ""}`}
          onClick={() => props.onViewChange("mic-test")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
          <span>{t("sidebar.micTest")}</span>
        </button>

        <button
          class={`sidebar-item ${props.currentView === "models" ? "active" : ""}`}
          onClick={() => props.onViewChange("models")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
          <span>{t("sidebar.models")}</span>
        </button>

        <button
          class={`sidebar-item ${props.currentView === "dictionary" ? "active" : ""}`}
          onClick={() => props.onViewChange("dictionary")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          <span>{t("sidebar.dictionary")}</span>
        </button>

        <div class="sidebar-divider" />

        <button
          class={`sidebar-item ${props.currentView === "settings" ? "active" : ""}`}
          onClick={() => props.onViewChange("settings")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>{t("sidebar.settings")}</span>
        </button>

        <button
          class={`sidebar-item ${props.currentView === "about" ? "active" : ""}`}
          onClick={() => props.onViewChange("about")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>{t("sidebar.about")}</span>
        </button>
      </nav>

    </aside>
  );
}
