import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { likeLastSound } from "../lib/sounds";

type OverlayState = "recording" | "transcribing" | "done" | "error";

export default function DictationOverlay() {
  const [state, setState] = createSignal<OverlayState>("recording");
  const [text, setText] = createSignal("");
  const [audioLevel, setAudioLevel] = createSignal(0);
  const [progressPct, setProgressPct] = createSignal(0);
  const [visible, setVisible] = createSignal(false);
  const [showThumbsUp, setShowThumbsUp] = createSignal(false);

  onMount(() => {
    const unlisten1 = listen<string>("overlay-state", (e) => {
      const s = e.payload as OverlayState;
      setState(s);
      setVisible(true);
      if (s === "done") {
        setShowThumbsUp(true);
        setTimeout(() => setShowThumbsUp(false), 3000);
        setTimeout(() => setVisible(false), 2000);
      } else if (s === "error") {
        setTimeout(() => setVisible(false), 3000);
      }
    });

    const unlisten2 = listen<string>("overlay-text", (e) => {
      setText(e.payload);
    });

    const unlisten3 = listen<number>("overlay-audio-level", (e) => {
      const raw = Math.min(1, Math.max(0, e.payload));
      setAudioLevel((prev) => prev * 0.3 + raw * 0.7);
    });

    const unlisten4 = listen<number>("overlay-progress", (e) => {
      setProgressPct(e.payload);
    });

    onCleanup(() => {
      unlisten1.then((f) => f());
      unlisten2.then((f) => f());
      unlisten3.then((f) => f());
      unlisten4.then((f) => f());
    });
  });

  const dotColor = () => {
    switch (state()) {
      case "recording":   return "#e74c3c";
      case "transcribing": return "#3498db";
      case "done":        return "#27ae60";
      case "error":       return "#e74c3c";
    }
  };

  return (
    <>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
      <div
        style={{
          opacity: visible() ? 1 : 0,
          transition: "opacity 50ms ease-in",
          display: "flex",
          "align-items": "center",
          gap: "8px",
          background: "#1e1e2e",
          "border-radius": "24px",
          padding: "8px 16px",
          "box-shadow": "0 4px 12px rgba(0,0,0,0.4)",
          "font-family": "system-ui, sans-serif",
          width: "168px",
          "box-sizing": "border-box",
        }}
      >
        {/* Status dot with glow */}
        <div
          style={{
            width: "8px",
            height: "8px",
            "border-radius": "50%",
            background: dotColor(),
            "box-shadow": `0 0 8px ${dotColor()}`,
            "flex-shrink": "0",
          }}
        />

        {/* State icon */}
        <Show when={state() === "recording"}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2" style={{ "flex-shrink": "0" }}>
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          </svg>
        </Show>
        <Show when={state() === "transcribing"}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ccc"
            stroke-width="2"
            style={{ animation: "spin 1s linear infinite", "flex-shrink": "0" }}
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </Show>
        <Show when={state() === "done"}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#27ae60" stroke-width="2.5" style={{ "flex-shrink": "0" }}>
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </Show>
        <Show when={state() === "error"}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2.5" style={{ "flex-shrink": "0" }}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </Show>

        {/* Right side content */}
        <Show when={state() === "recording"}>
          <div
            style={{
              flex: "1",
              height: "6px",
              background: "#333",
              "border-radius": "3px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.min(100, audioLevel() * 1000)}%`,
                height: "6px",
                background:
                  audioLevel() > 0.08
                    ? "#e74c3c"
                    : audioLevel() > 0.05
                    ? "#f1c40f"
                    : "#27ae60",
                "border-radius": "3px",
                transition: "width 80ms ease-out",
              }}
            />
          </div>
        </Show>
        <Show when={state() === "transcribing"}>
          <div
            style={{
              flex: "1",
              height: "6px",
              background: "#333",
              "border-radius": "3px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progressPct()}%`,
                height: "6px",
                background: "#3498db",
                "border-radius": "3px",
                transition: "width 200ms ease-out",
              }}
            />
          </div>
        </Show>
        <Show when={state() === "done"}>
          <span
            style={{
              color: "#ccc",
              "font-size": "11px",
              flex: "1",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
            }}
          >
            {text()}
          </span>
        </Show>
        <Show when={state() === "done" && showThumbsUp()}>
          <button
            onClick={() => { likeLastSound(); setShowThumbsUp(false); }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              "font-size": "14px",
              padding: "0 4px",
              opacity: 0.7,
            }}
            title="Like this sound"
          >
            👍
          </button>
        </Show>
        <Show when={state() === "error"}>
          <span
            style={{
              color: "#e74c3c",
              "font-size": "11px",
              flex: "1",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
            }}
          >
            {text()}
          </span>
        </Show>
      </div>
    </>
  );
}
