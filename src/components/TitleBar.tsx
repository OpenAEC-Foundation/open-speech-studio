import { useI18n } from "../lib/i18n";
import appIcon from "../assets/icon.png";

const isTauri = !!(window as any).__TAURI_INTERNALS__;
const isMac = navigator.platform?.startsWith("Mac");

export default function TitleBar() {
  const { t } = useI18n();
  const minimize = async () => {
    if (!isTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().minimize();
  };

  const close = async () => {
    if (!isTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().close();
  };

  return (
    <div class={`titlebar ${isMac ? "titlebar-mac" : ""}`} data-tauri-drag-region>
      {isMac && <div class="titlebar-mac-spacer" data-tauri-drag-region />}
      <img class="titlebar-icon" src={appIcon} alt="" width="16" height="16" data-tauri-drag-region />
      <div class="titlebar-title" data-tauri-drag-region>
        Open Speech Studio <span class="titlebar-version">v0.7.0</span>
      </div>
      <div class="titlebar-buttons">
        <a
          class="titlebar-feedback"
          href="https://github.com/OpenAEC-Foundation/open-speech-studio/issues"
          target="_blank"
          rel="noopener"
        >
          {t("sidebar.feedback")}
        </a>
        {!isMac && (
          <button class="titlebar-btn" onClick={minimize} aria-label="Minimize">
            <svg width="10" height="1" viewBox="0 0 10 1">
              <rect width="10" height="1" fill="currentColor" />
            </svg>
          </button>
        )}
        {!isMac && (
          <button class="titlebar-btn titlebar-btn-close" onClick={close} aria-label="Close">
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M1.7.3a1 1 0 00-1.4 1.4L3.6 5 .3 8.3a1 1 0 001.4 1.4L5 6.4l3.3 3.3a1 1 0 001.4-1.4L6.4 5l3.3-3.3A1 1 0 008.3.3L5 3.6 1.7.3z" fill="currentColor" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
