import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import type { OverlayPayload } from "../lib/overlay";

type State = "recording" | "transcribing" | "done" | "error";

export default function DictationOverlay() {
  const [state, setState] = createSignal<State>("recording");
  const [text, setText] = createSignal("");
  const [audioLevel, setAudioLevel] = createSignal(0);
  const [pct, setPct] = createSignal(0);
  const [remainingS, setRemainingS] = createSignal(0);
  const [visible, setVisible] = createSignal(false);

  let raf = 0;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const stopAnim = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  /** Animate 0 → 96% over the estimated duration, locally at 60fps. */
  const startAnim = (estimatedMs: number) => {
    stopAnim();
    const t0 = performance.now();
    const tick = (now: number) => {
      const elapsed = now - t0;
      setPct(Math.min(96, (elapsed / estimatedMs) * 100));
      setRemainingS(Math.max(0, Math.ceil((estimatedMs - elapsed) / 1000)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  onMount(() => {
    const subs = [
      listen<OverlayPayload>("overlay-show", (e) => {
        const p = e.payload;
        clearTimeout(hideTimer);
        setState(p.state);
        setVisible(true);

        switch (p.state) {
          case "recording":
            stopAnim();
            setText("");
            setAudioLevel(0);
            break;
          case "transcribing":
            setPct(0);
            startAnim(Math.max(800, p.estimatedMs || 3000));
            break;
          case "done":
            stopAnim();
            setPct(100);
            setText(p.text || "");
            hideTimer = setTimeout(() => setVisible(false), 2000);
            break;
          case "error":
            stopAnim();
            setText(p.text || "");
            hideTimer = setTimeout(() => setVisible(false), 3000);
            break;
        }
      }),
      listen<number>("overlay-audio-level", (e) => {
        const raw = Math.min(1, Math.max(0, e.payload));
        setAudioLevel((prev) => prev * 0.3 + raw * 0.7);
      }),
    ];

    onCleanup(() => {
      stopAnim();
      clearTimeout(hideTimer);
      subs.forEach((s) => s.then((f) => f()));
    });
  });

  const dotColor = () => {
    switch (state()) {
      case "recording":    return "#e74c3c";
      case "transcribing": return "#3498db";
      case "done":         return "#27ae60";
      case "error":        return "#e74c3c";
    }
  };

  return (
    <>
      <style>{`
        html, body, #app { background: transparent !important; margin: 0; padding: 0; overflow: hidden; }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
      <div
        class="dictation-overlay"
        style={{
          opacity: visible() ? 1 : 0,
          transition: "opacity 120ms ease-in",
          display: "flex",
          "align-items": "center",
          gap: "8px",
          background: "#1e1e2e",
          "border-radius": "22px",
          padding: "0 14px",
          height: "40px",
          "box-shadow": "0 4px 12px rgba(0,0,0,0.4)",
          "font-family": "system-ui, sans-serif",
          width: "288px",
          "box-sizing": "border-box",
          margin: "2px auto",
        }}
      >
        {/* Status dot */}
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

        {/* Recording: live audio level */}
        <Show when={state() === "recording"}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2" style={{ "flex-shrink": "0" }}>
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          </svg>
          <div style={{ flex: "1", height: "6px", background: "#333", "border-radius": "3px", overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.min(100, audioLevel() * 1000)}%`,
                height: "100%",
                background: audioLevel() > 0.08 ? "#e74c3c" : audioLevel() > 0.05 ? "#f1c40f" : "#27ae60",
                "border-radius": "3px",
                transition: "width 80ms ease-out",
              }}
            />
          </div>
        </Show>

        {/* Transcribing: progress toward estimate + countdown */}
        <Show when={state() === "transcribing"}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2"
            style={{ animation: "spin 1s linear infinite", "flex-shrink": "0" }}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <div style={{ flex: "1", height: "6px", background: "#333", "border-radius": "3px", overflow: "hidden" }}>
            <div
              style={{
                width: `${pct()}%`,
                height: "100%",
                background: "#3498db",
                "border-radius": "3px",
              }}
            />
          </div>
          <span
            style={{
              color: "#aaa",
              "font-size": "11px",
              "font-variant-numeric": "tabular-nums",
              "flex-shrink": "0",
              "min-width": "30px",
              "text-align": "right",
            }}
          >
            {remainingS() > 0 ? `~${remainingS()}s` : "..."}
          </span>
        </Show>

        {/* Done: checkmark + text */}
        <Show when={state() === "done"}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#27ae60" stroke-width="2.5" style={{ "flex-shrink": "0" }}>
            <path d="M20 6L9 17l-5-5" />
          </svg>
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

        {/* Error: cross + message */}
        <Show when={state() === "error"}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2.5" style={{ "flex-shrink": "0" }}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
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
