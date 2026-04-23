import { useI18n } from "../lib/i18n";
import appIcon from "../assets/icon.png";

export default function About() {
  const { t } = useI18n();
  return (
    <div class="about-page">
      <div class="about-header">
        <img class="about-icon" src={appIcon} alt="" width="64" height="64" />
        <div>
          <h2>Open Speech Studio</h2>
          <span class="about-version">v0.10.0</span>
        </div>
      </div>

      <p class="about-description">{t("about.description")}</p>

      <div class="about-section">
        <div class="about-row">
          <span class="about-label">{t("about.license")}</span>
          <span>Apache-2.0</span>
        </div>
        <div class="about-row">
          <span class="about-label">{t("about.developer")}</span>
          <a href="https://open-aec.com/" target="_blank" rel="noopener">OpenAEC Foundation</a>
        </div>
        <div class="about-row">
          <span class="about-label">{t("about.source")}</span>
          <a href="https://github.com/OpenAEC-Foundation/open-speech-studio" target="_blank" rel="noopener">GitHub</a>
        </div>
      </div>

      <p class="about-copyright">{t("about.copyright")}</p>
    </div>
  );
}
