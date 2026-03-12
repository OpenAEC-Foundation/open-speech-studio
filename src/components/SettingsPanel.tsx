import { createSignal, onMount, Show } from "solid-js";
import { api, type Settings } from "../lib/api";
import { useI18n, getLanguageOptions, type Locale } from "../lib/i18n";

interface SettingsPanelProps {
  settings: Settings | null;
  onSave: (settings: Settings) => void;
}

// Parse a hotkey string into up to 3 parts
function parseHotkey(hotkey: string): { key1: string; key2: string; key3: string } {
  const parts = hotkey.split("+");
  return {
    key1: parts[0] || "CmdOrCtrl",
    key2: parts.length > 1 ? parts[1] : "none",
    key3: parts.length > 2 ? parts[2] : "none",
  };
}

function buildHotkey(key1: string, key2: string, key3: string): string {
  const parts = [key1, key2, key3].filter((k) => k !== "none");
  return parts.join("+");
}

// All available keys for the builder
const MODIFIER_KEYS = [
  { value: "none", label: "Geen" },
  { value: "CmdOrCtrl", label: "Ctrl / Cmd" },
  { value: "Super", label: "Win / Super" },
  { value: "Alt", label: "Alt" },
  { value: "Shift", label: "Shift" },
];

const ALL_KEYS = [
  { group: "settings.keyGroupModifiers", keys: [
    { value: "CmdOrCtrl", label: "Ctrl / Cmd" },
    { value: "Super", label: "Win / Super" },
    { value: "Alt", label: "Alt" },
    { value: "Shift", label: "Shift" },
  ]},
  { group: "settings.keyGroupSpecial", keys: [
    { value: "Space", label: "Space" },
    { value: "Enter", label: "Enter" },
    { value: "Tab", label: "Tab" },
    { value: "Escape", label: "Escape" },
  ]},
  { group: "settings.keyGroupLetters", keys: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => ({ value: l, label: l })) },
  { group: "settings.keyGroupDigits", keys: "0123456789".split("").map((n) => ({ value: n, label: n })) },
  { group: "settings.keyGroupFunction", keys: Array.from({ length: 12 }, (_, i) => ({ value: `F${i + 1}`, label: `F${i + 1}` })) },
];

export default function SettingsPanel(props: SettingsPanelProps) {
  const { t, locale, setLocale } = useI18n();
  const [language, setLanguage] = createSignal("auto");
  const [useGpu, setUseGpu] = createSignal(false);
  const [autoPaste, setAutoPaste] = createSignal(true);
  const [audioDevice, setAudioDevice] = createSignal("default");
  const [devices, setDevices] = createSignal<string[]>([]);

  // Hotkey builder — supports 2 or 3 key combos
  const [key1, setKey1] = createSignal("CmdOrCtrl");
  const [key2, setKey2] = createSignal("Super");
  const [key3, setKey3] = createSignal("none");

  const hotkey = () => buildHotkey(key1(), key2(), key3());

  onMount(async () => {
    if (props.settings) {
      setLanguage(props.settings.language);
      setUseGpu(props.settings.use_gpu);
      setAutoPaste(props.settings.auto_paste);
      setAudioDevice(props.settings.audio_device);

      const parsed = parseHotkey(props.settings.hotkey || "Alt+Space");
      setKey1(parsed.key1);
      setKey2(parsed.key2);
      setKey3(parsed.key3);
    }

    try {
      const devs = await api.getAudioDevices();
      setDevices(devs);
    } catch (e) {
      console.error("Failed to get audio devices:", e);
    }
  });

  const handleSave = () => {
    if (!props.settings) return;
    props.onSave({
      ...props.settings,
      language: language(),
      ui_language: locale(),
      use_gpu: useGpu(),
      hotkey: hotkey(),
      auto_paste: autoPaste(),
      audio_device: audioDevice(),
    });
  };

  return (
    <div class="settings-panel">
      <h2>{t("settings.title")}</h2>

      <div class="settings-section">
        <h3>{t("settings.display")}</h3>
        <div class="setting-row">
          <label>{t("settings.uiLanguage")}</label>
          <select
            value={locale()}
            onChange={(e) => {
              const newLang = e.target.value as Locale;
              setLocale(newLang);
              if (props.settings) {
                props.onSave({ ...props.settings, ui_language: newLang });
              }
            }}
          >
            <option value="nl">Nederlands</option>
            <option value="en">English</option>
          </select>
          <span class="setting-hint">{t("settings.uiLanguageHint")}</span>
        </div>
      </div>

      <div class="settings-section">
        <h3>{t("settings.speechRecognition")}</h3>

        <div class="setting-row">
          <label>{t("settings.language")}</label>
          <select value={language()} onChange={(e) => setLanguage(e.target.value)}>
            <option value="auto">{t("languages.auto")}</option>
            <option value="en">{t("languages.enFull")}</option>
            <option value="nl">{t("languages.nlFull")}</option>
            <option value="de">{t("languages.deFull")}</option>
            <option value="fr">{t("languages.frFull")}</option>
            <option value="es">{t("languages.esFull")}</option>
            <option value="it">{t("languages.itFull")}</option>
            <option value="pt">{t("languages.ptFull")}</option>
            <option value="pl">{t("languages.plFull")}</option>
            <option value="ja">{t("languages.jaFull")}</option>
            <option value="zh">{t("languages.zhFull")}</option>
          </select>
        </div>

        <div class="setting-row">
          <label>{t("settings.gpuAcceleration")}</label>
          <div class="toggle-group">
            <label class="toggle">
              <input
                type="checkbox"
                checked={useGpu()}
                onChange={(e) => setUseGpu(e.target.checked)}
              />
              <span class="toggle-slider" />
            </label>
            <span class="setting-hint">
              {useGpu()
                ? t("settings.gpuEnabled")
                : t("settings.gpuDisabled")}
            </span>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3>{t("settings.controls")}</h3>

        <div class="setting-row">
          <label>{t("settings.hotkey")}</label>
          <div class="hotkey-builder">
            {/* Toets 1 — altijd verplicht */}
            <select value={key1()} onChange={(e) => setKey1(e.target.value)}>
              {ALL_KEYS.map((group) => (
                <optgroup label={t(group.group)}>
                  {group.keys.map((k) => (
                    <option value={k.value}>{k.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span class="hotkey-plus">+</span>
            {/* Toets 2 — verplicht */}
            <select value={key2()} onChange={(e) => setKey2(e.target.value)}>
              {ALL_KEYS.map((group) => (
                <optgroup label={t(group.group)}>
                  {group.keys.map((k) => (
                    <option value={k.value}>{k.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span class="hotkey-plus">+</span>
            {/* Toets 3 — optioneel */}
            <select value={key3()} onChange={(e) => setKey3(e.target.value)}>
              <option value="none">{t("settings.hotkeyNone2Keys")}</option>
              {ALL_KEYS.map((group) => (
                <optgroup label={t(group.group)}>
                  {group.keys.map((k) => (
                    <option value={k.value}>{k.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <span class="setting-hint">{t("settings.hotkeyPreview")} <kbd class="hotkey-preview">{hotkey()}</kbd></span>
        </div>

        <div class="setting-row">
          <label>{t("settings.autoPaste")}</label>
          <div class="toggle-group">
            <label class="toggle">
              <input
                type="checkbox"
                checked={autoPaste()}
                onChange={(e) => setAutoPaste(e.target.checked)}
              />
              <span class="toggle-slider" />
            </label>
            <span class="setting-hint">
              {t("settings.autoPasteHint")}
            </span>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3>{t("settings.audio")}</h3>

        <div class="setting-row">
          <label>{t("settings.inputDevice")}</label>
          <select value={audioDevice()} onChange={(e) => setAudioDevice(e.target.value)}>
            <option value="default">{t("settings.defaultMic")}</option>
            {devices().map((d) => (
              <option value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      <div class="settings-actions">
        <button class="btn btn-primary" onClick={handleSave}>
          {t("settings.save")}
        </button>
      </div>
    </div>
  );
}
