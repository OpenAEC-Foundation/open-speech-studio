import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { useI18n } from "../lib/i18n";

type OverlayState = "recording" | "transcribing" | "done" | "error";

export default function DictationOverlay() {
  const { t } = useI18n();
  const [state, setState] = createSignal<OverlayState>("recording");
  const [text, setText] = createSignal("");
  const [dots, setDots] = createSignal("");
  const [countdown, setCountdown] = createSignal<number | null>(null);
  const [audioLevel, setAudioLevel] = createSignal(0);

  // Animate dots for "transcribing" state
  let dotsInterval: ReturnType<typeof setInterval>;
  let countdownInterval: ReturnType<typeof setInterval>;

  onMount(() => {
    dotsInterval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 400);

    // Countdown timer: decrement every second while transcribing
    countdownInterval = setInterval(() => {
      if (state() === "transcribing") {
        setCountdown((c) => (c !== null && c > 1 ? c - 1 : c));
      }
    }, 1000);
  });

  onCleanup(() => {
    clearInterval(dotsInterval);
    clearInterval(countdownInterval);
  });

  // Listen for events from main window
  onMount(async () => {
    const { listen } = await import("@tauri-apps/api/event");
    const { getCurrentWindow } = await import("@tauri-apps/api/window");

    const unlisten1 = await listen<string>("overlay-state", (event) => {
      const newState = event.payload as OverlayState;
      setState(newState);
      if (newState !== "transcribing") {
        setCountdown(null);
      }
      if (newState !== "recording") {
        setAudioLevel(0);
      }
    });

    const unlisten2 = await listen<string>("overlay-text", (event) => {
      const payload = event.payload;
      // Check if it's an estimate like "~5s"
      const match = payload.match(/^~(\d+)s$/);
      if (match && state() === "transcribing") {
        setCountdown(parseInt(match[1], 10));
      } else {
        setText(payload);
      }
    });

    const unlisten3 = await listen<void>("overlay-close", async () => {
      try {
        const win = getCurrentWindow();
        await win.destroy();
      } catch (_) {}
    });

    const unlisten4 = await listen<number>("overlay-audio-level", (event) => {
      // Clamp to 0-1 range, apply slight smoothing
      const raw = Math.min(1, Math.max(0, event.payload));
      setAudioLevel((prev) => prev * 0.3 + raw * 0.7);
    });

    onCleanup(() => {
      unlisten1();
      unlisten2();
      unlisten3();
      unlisten4();
    });
  });

  const stateIcon = () => {
    switch (state()) {
      case "recording":
        return (
          <div class="overlay-icon recording">
            <div class="overlay-mic-ring" />
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" fill="none" stroke="currentColor" stroke-width="2" />
            </svg>
          </div>
        );
      case "transcribing":
        return (
          <div class="overlay-icon transcribing">
            <div class="overlay-spinner" />
          </div>
        );
      case "done":
        return (
          <div class="overlay-icon done">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        );
      case "error":
        return (
          <div class="overlay-icon error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
        );
    }
  };

  const stateLabel = () => {
    switch (state()) {
      case "recording":
        return t("overlay.listening");
      case "transcribing": {
        const c = countdown();
        if (c !== null && c > 0) {
          return `${t("overlay.transcribing")} ~${c}s${dots()}`;
        }
        return `${t("overlay.transcribing")}${dots()}`;
      }
      case "done":
        return text() || t("overlay.done");
      case "error":
        return text() || t("overlay.error");
    }
  };

  return (
    <div class={`dictation-overlay state-${state()}`}>
      {stateIcon()}
      <div class="overlay-content">
        <span class="overlay-label">{stateLabel()}</span>
        <Show when={state() === "recording"}>
          <div class="overlay-level-bar">
            <div
              class="overlay-level-fill"
              style={{ width: `${Math.round(audioLevel() * 100)}%` }}
            />
          </div>
        </Show>
      </div>
    </div>
  );
}
