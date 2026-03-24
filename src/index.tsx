/* @refresh reload */
import { render } from "solid-js/web";
import { I18nProvider } from "./lib/i18n";
import "./styles/app.css";

// Disable browser context menu and default shortcuts in production
if (!import.meta.env.DEV) {
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("keydown", (e) => {
    // Prevent refresh (F5, Ctrl+R)
    if (e.key === "F5" || (e.ctrlKey && e.key === "r")) e.preventDefault();
    // Prevent find (Ctrl+F, Ctrl+G)
    if (e.ctrlKey && (e.key === "f" || e.key === "g")) e.preventDefault();
    // Prevent print (Ctrl+P)
    if (e.ctrlKey && e.key === "p") e.preventDefault();
    // Prevent save (Ctrl+S)
    if (e.ctrlKey && e.key === "s") e.preventDefault();
    // Prevent open (Ctrl+O)
    if (e.ctrlKey && e.key === "o") e.preventDefault();
    // Prevent dev tools (F12, Ctrl+Shift+I/J/C)
    if (e.key === "F12") e.preventDefault();
    if (e.ctrlKey && e.shiftKey && ["i", "j", "c"].includes(e.key.toLowerCase())) e.preventDefault();
  });
}

const isOverlay = new URLSearchParams(window.location.search).has("overlay");

if (isOverlay) {
  // Force all layers transparent for the overlay webview
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  document.getElementById("app")!.style.background = "transparent";

  import("./components/DictationOverlay").then(({ default: DictationOverlay }) => {
    render(() => (
      <I18nProvider>
        <DictationOverlay />
      </I18nProvider>
    ), document.getElementById("app")!);
  });
} else {
  import("./App").then(({ default: App }) => {
    render(() => (
      <I18nProvider>
        <App />
      </I18nProvider>
    ), document.getElementById("app")!);
  });
}
