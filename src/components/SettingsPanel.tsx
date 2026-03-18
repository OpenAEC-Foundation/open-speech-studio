import { createSignal, onMount, For } from "solid-js";
import { api, type Settings } from "../lib/api";
import { useI18n, getLanguageOptions, type Locale } from "../lib/i18n";

interface SettingsPanelProps {
  settings: Settings | null;
  onSave: (settings: Settings) => void;
}

function parseHotkey(hotkey: string): { key1: string; key2: string; key3: string } {
  const parts = hotkey.split("+");
  return {
    key1: parts[0] || "CmdOrCtrl",
    key2: parts.length > 1 ? parts[1] : "none",
    key3: parts.length > 2 ? parts[2] : "none",
  };
}

function buildHotkey(key1: string, key2: string, key3: string): string {
  return [key1, key2, key3].filter((k) => k !== "none").join("+");
}

const isMac = navigator.platform?.startsWith("Mac");

const ALL_KEYS = [
  { group: "settings.keyGroupModifiers", keys: [
    { value: "CmdOrCtrl", label: isMac ? "Cmd" : "Ctrl" },
    { value: "Super", label: isMac ? "Cmd" : "Win" },
    { value: "Alt", label: isMac ? "Option" : "Alt" },
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

type SettingsTab = "general" | "speech" | "controls" | "audio" | "files";

export default function SettingsPanel(props: SettingsPanelProps) {
  const { t, locale, setLocale } = useI18n();
  const [tab, setTab] = createSignal<SettingsTab>("general");
  const [language, setLanguage] = createSignal("auto");
  const [useGpu, setUseGpu] = createSignal(false);
  const [autoPaste, setAutoPaste] = createSignal(true);
  const [audioDevice, setAudioDevice] = createSignal("default");
  const [devices, setDevices] = createSignal<string[]>([]);
  const [fileAutoSave, setFileAutoSave] = createSignal(false);
  const [fileSaveDir, setFileSaveDir] = createSignal("");
  const [fileConfirmActions, setFileConfirmActions] = createSignal(true);

  const [key1, setKey1] = createSignal("CmdOrCtrl");
  const [key2, setKey2] = createSignal("Super");
  const [key3, setKey3] = createSignal("none");
  const [hotkeyMode, setHotkeyMode] = createSignal("hold");
  const [hotkeyDirty, setHotkeyDirty] = createSignal(false);

  const hotkey = () => buildHotkey(key1(), key2(), key3());

  onMount(async () => {
    if (props.settings) {
      setLanguage(props.settings.language);
      setUseGpu(props.settings.use_gpu);
      setAutoPaste(props.settings.auto_paste);
      setAudioDevice(props.settings.audio_device);
      setFileAutoSave(props.settings.file_auto_save ?? false);
      setFileSaveDir(props.settings.file_save_directory ?? "");
      setFileConfirmActions(props.settings.file_confirm_actions ?? true);
      const parsed = parseHotkey(props.settings.hotkey || "Alt+Space");
      setKey1(parsed.key1);
      setKey2(parsed.key2);
      setKey3(parsed.key3);
      setHotkeyMode(props.settings.hotkey_mode || "hold");
    }
    try {
      const devs = await api.getAudioDevices();
      setDevices(devs);
    } catch (e) {
      console.error("Failed to get audio devices:", e);
    }
  });

  const autoSave = (partial: Partial<Settings>) => {
    if (!props.settings) return;
    props.onSave({ ...props.settings, ...partial });
  };

  const handleSaveHotkey = () => {
    if (!props.settings) return;
    props.onSave({
      ...props.settings,
      hotkey: hotkey(),
      hotkey_mode: hotkeyMode(),
    });
    setHotkeyDirty(false);
  };

  return (
    <div class="settings-panel">
      <h2>{t("settings.title")}</h2>

      <div class="settings-tabs">
        <button class={`settings-tab ${tab() === "general" ? "active" : ""}`} onClick={() => setTab("general")}>
          {t("settings.tabGeneral")}
        </button>
        <button class={`settings-tab ${tab() === "speech" ? "active" : ""}`} onClick={() => setTab("speech")}>
          {t("settings.tabSpeech")}
        </button>
        <button class={`settings-tab ${tab() === "controls" ? "active" : ""}`} onClick={() => setTab("controls")}>
          {t("settings.tabControls")}
        </button>
        <button class={`settings-tab ${tab() === "audio" ? "active" : ""}`} onClick={() => setTab("audio")}>
          {t("settings.tabAudio")}
        </button>
        <button class={`settings-tab ${tab() === "files" ? "active" : ""}`} onClick={() => setTab("files")}>
          {t("settings.tabFiles")}
        </button>
      </div>

      {/* ── General ── */}
      <div class="settings-tab-content" style={{ display: tab() === "general" ? "block" : "none" }}>
        <div class="settings-section">
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
              <option value="bg">Bulgarian (&#1041;&#1098;&#1083;&#1075;&#1072;&#1088;&#1089;&#1082;&#1080;)</option>
              <option value="zh">Chinese (&#20013;&#25991;)</option>
              <option value="hr">Croatian (Hrvatski)</option>
              <option value="cs">Czech (&#268;e&#353;tina)</option>
              <option value="da">Danish (Dansk)</option>
              <option value="nl">Dutch (Nederlands)</option>
              <option value="en">English</option>
              <option value="fi">Finnish (Suomi)</option>
              <option value="fr">French (Fran&#231;ais)</option>
              <option value="de">German (Deutsch)</option>
              <option value="el">Greek (&#917;&#955;&#955;&#951;&#957;&#953;&#954;&#940;)</option>
              <option value="hu">Hungarian (Magyar)</option>
              <option value="it">Italian (Italiano)</option>
              <option value="ja">Japanese (&#26085;&#26412;&#35486;)</option>
              <option value="ko">Korean (&#54620;&#44397;&#50612;)</option>
              <option value="no">Norwegian (Norsk)</option>
              <option value="pl">Polish (Polski)</option>
              <option value="pt">Portuguese (Portugu&#234;s)</option>
              <option value="ro">Romanian (Rom&#226;n&#259;)</option>
              <option value="ru">Russian (&#1056;&#1091;&#1089;&#1089;&#1082;&#1080;&#1081;)</option>
              <option value="sk">Slovak (Sloven&#269;ina)</option>
              <option value="es">Spanish (Espa&#241;ol)</option>
              <option value="sv">Swedish (Svenska)</option>
              <option value="tr">Turkish (T&#252;rk&#231;e)</option>
              <option value="uk">Ukrainian (&#1059;&#1082;&#1088;&#1072;&#1111;&#1085;&#1089;&#1100;&#1082;&#1072;)</option>
            </select>
            <span class="setting-hint">{t("settings.uiLanguageHint")}</span>
          </div>
        </div>
      </div>

      {/* ── Speech ── */}
      <div class="settings-tab-content" style={{ display: tab() === "speech" ? "block" : "none" }}>
        <div class="settings-section">
          <div class="setting-row">
            <label>{t("settings.language")}</label>
            <select value={language()} onChange={(e) => { setLanguage(e.target.value); autoSave({ language: e.target.value }); }}>
              <For each={getLanguageOptions(t)}>
                {(lang) => <option value={lang.value}>{lang.label}</option>}
              </For>
            </select>
          </div>

          <div class="setting-row">
            <label>{t("settings.gpuAcceleration")}</label>
            <div class="toggle-group">
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={useGpu()}
                  onChange={(e) => { setUseGpu(e.target.checked); autoSave({ use_gpu: e.target.checked }); }}
                />
                <span class="toggle-slider" />
              </label>
              <span class="setting-hint">
                {useGpu() ? t("settings.gpuEnabled") : t("settings.gpuDisabled")}
              </span>
            </div>
          </div>

          <div class="setting-row">
            <label>{t("settings.autoPaste")}</label>
            <div class="toggle-group">
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={autoPaste()}
                  onChange={(e) => { setAutoPaste(e.target.checked); autoSave({ auto_paste: e.target.checked }); }}
                />
                <span class="toggle-slider" />
              </label>
              <span class="setting-hint">{t("settings.autoPasteHint")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Controls ── */}
      <div class="settings-tab-content" style={{ display: tab() === "controls" ? "block" : "none" }}>
        <div class="settings-section">
          <div class="setting-row">
            <label>{t("settings.hotkey")}</label>
            <div class="hotkey-builder">
              <select value={key1()} onChange={(e) => { setKey1(e.target.value); setHotkeyDirty(true); }}>
                {ALL_KEYS.map((group) => (
                  <optgroup label={t(group.group)}>
                    {group.keys.map((k) => (
                      <option value={k.value}>{k.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span class="hotkey-plus">+</span>
              <select value={key2()} onChange={(e) => { setKey2(e.target.value); setHotkeyDirty(true); }}>
                {ALL_KEYS.map((group) => (
                  <optgroup label={t(group.group)}>
                    {group.keys.map((k) => (
                      <option value={k.value}>{k.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span class="hotkey-plus">+</span>
              <select value={key3()} onChange={(e) => { setKey3(e.target.value); setHotkeyDirty(true); }}>
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
            <label>{t("settings.hotkeyMode")}</label>
            <select value={hotkeyMode()} onChange={(e) => { setHotkeyMode(e.target.value); setHotkeyDirty(true); }}>
              <option value="hold">{t("settings.hotkeyModeHold")}</option>
              <option value="toggle">{t("settings.hotkeyModeToggle")}</option>
            </select>
            <span class="setting-hint">{t("settings.hotkeyModeHint")}</span>
          </div>

          <div class="settings-actions">
            <button class="btn btn-primary" onClick={handleSaveHotkey} disabled={!hotkeyDirty()}>
              {t("settings.save")}
            </button>
          </div>
        </div>
      </div>

      {/* ── Audio ── */}
      <div class="settings-tab-content" style={{ display: tab() === "audio" ? "block" : "none" }}>
        <div class="settings-section">
          <div class="setting-row">
            <label>{t("settings.inputDevice")}</label>
            <select value={audioDevice()} onChange={(e) => { setAudioDevice(e.target.value); autoSave({ audio_device: e.target.value }); }}>
              <option value="default">{t("settings.defaultMic")}</option>
              {devices().map((d) => (
                <option value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── Files ── */}
      <div class="settings-tab-content" style={{ display: tab() === "files" ? "block" : "none" }}>
        <div class="settings-section">
          <div class="setting-row">
            <label>{t("settings.fileAutoSave")}</label>
            <div class="toggle-group">
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={fileAutoSave()}
                  onChange={(e) => { setFileAutoSave(e.target.checked); autoSave({ file_auto_save: e.target.checked }); }}
                />
                <span class="toggle-slider" />
              </label>
              <span class="setting-hint">
                {fileAutoSave() ? t("settings.fileAutoSaveEnabled") : t("settings.fileAutoSaveDisabled")}
              </span>
            </div>
          </div>

          <div class="setting-row" style={{ opacity: fileAutoSave() ? 1 : 0.4 }}>
            <label>{t("settings.fileSaveDirectory")}</label>
            <div class="file-dir-picker">
              <input
                type="text"
                value={fileSaveDir()}
                placeholder={t("settings.fileSaveDirPlaceholder")}
                readOnly
                disabled={!fileAutoSave()}
              />
              <button
                class="btn btn-small"
                disabled={!fileAutoSave()}
                onClick={async () => {
                  try {
                    const { open } = await import("@tauri-apps/plugin-dialog");
                    const dir = await open({ directory: true });
                    if (dir) {
                      setFileSaveDir(dir as string);
                      autoSave({ file_save_directory: dir as string });
                    }
                  } catch (_) {}
                }}
              >
                {t("settings.fileSaveDirBrowse")}
              </button>
            </div>
            <span class="setting-hint">{t("settings.fileSaveDirHint")}</span>
          </div>

          <div class="setting-row">
            <label>{t("settings.fileConfirmActions")}</label>
            <div class="toggle-group">
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={fileConfirmActions()}
                  onChange={(e) => { setFileConfirmActions(e.target.checked); autoSave({ file_confirm_actions: e.target.checked }); }}
                />
                <span class="toggle-slider" />
              </label>
              <span class="setting-hint">
                {fileConfirmActions() ? t("settings.fileConfirmEnabled") : t("settings.fileConfirmDisabled")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
