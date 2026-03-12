/* @refresh reload */
import { render } from "solid-js/web";
import { I18nProvider } from "./lib/i18n";
import App from "./App";
import "./styles/app.css";

render(() => (
  <I18nProvider>
    <App />
  </I18nProvider>
), document.getElementById("app")!);
