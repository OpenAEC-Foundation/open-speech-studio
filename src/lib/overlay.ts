/**
 * Single owner of the dictation overlay window.
 *
 * All overlay communication goes through ONE event ("overlay-show") with a
 * typed payload. Progress animation happens locally in the overlay window
 * (requestAnimationFrame) — the main window only sends the estimated
 * duration once, so there is no per-frame IPC traffic.
 */

const isTauri = !!(window as any).__TAURI_INTERNALS__;

const LABEL = "dictation-overlay";
const WIDTH = 296;
const HEIGHT = 44;
const MARGIN = 16;
const TASKBAR = 48;

export type OverlayPayload =
  | { state: "recording" }
  | { state: "transcribing"; estimatedMs: number }
  | { state: "done"; text: string }
  | { state: "error"; text: string };

let creating: Promise<void> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

async function ensureWindow(): Promise<void> {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  if (await WebviewWindow.getByLabel(LABEL)) return;
  if (creating) return creating;

  creating = (async () => {
    const { currentMonitor } = await import("@tauri-apps/api/window");
    const monitor = await currentMonitor();
    const screenW = monitor?.size?.width ?? 1920;
    const screenH = monitor?.size?.height ?? 1080;
    const scale = monitor?.scaleFactor ?? 1;

    const win = new WebviewWindow(LABEL, {
      url: "/?overlay=true",
      title: "Dictation",
      width: WIDTH,
      height: HEIGHT,
      x: Math.round(screenW / scale) - WIDTH - MARGIN,
      y: Math.round(screenH / scale) - HEIGHT - MARGIN - TASKBAR,
      decorations: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      transparent: true,
      focus: false,
      visible: false,
    });

    await new Promise<void>((resolve) => {
      win.once("tauri://window-created", () => resolve());
      setTimeout(resolve, 600);
    });
    // Give the webview a moment to mount its event listeners
    await new Promise((r) => setTimeout(r, 150));
  })();

  try {
    await creating;
  } finally {
    creating = null;
  }
}

export async function showOverlay(payload: OverlayPayload): Promise<void> {
  if (!isTauri) return;
  try {
    // A new show always cancels a pending close — no hide/show races.
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    await ensureWindow();
    const { emit } = await import("@tauri-apps/api/event");
    await emit("overlay-show", payload);
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = await WebviewWindow.getByLabel(LABEL);
    await win?.show();
  } catch (e) {
    console.error("Overlay error:", e);
  }
}

export async function emitOverlayAudioLevel(level: number): Promise<void> {
  if (!isTauri) return;
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit("overlay-audio-level", level);
  } catch (_) {}
}

/**
 * Hide the overlay window, optionally after a delay. The window is kept
 * alive and reused — one window per app session, never destroyed/recreated
 * (destroy/create cycles caused visible ghosting).
 */
export function closeOverlay(delayMs = 0): void {
  if (!isTauri) return;
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(async () => {
    closeTimer = null;
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const win = await WebviewWindow.getByLabel(LABEL);
      if (win) await win.hide();
    } catch (_) {}
  }, delayMs);
}
