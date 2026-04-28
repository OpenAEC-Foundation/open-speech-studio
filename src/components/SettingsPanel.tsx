import { createSignal, onMount, For, Show } from "solid-js";
import { api, auth, type Settings } from "../lib/api";
import { useI18n, getLanguageOptions, type Locale } from "../lib/i18n";
import { isAuthenticated, setAuthUser, initAuth } from "../lib/authStore";
import VoiceTraining from "./VoiceTraining";

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
  const { t, locale, setLocale, availableLocales } = useI18n();
  const [tab, setTab] = createSignal<SettingsTab>("general");
  const [language, setLanguage] = createSignal("auto");
  const [useGpu, setUseGpu] = createSignal(false);
  const [autoPaste, setAutoPaste] = createSignal(true);
  const [audioDevice, setAudioDevice] = createSignal("default");
  const [devices, setDevices] = createSignal<string[]>([]);
  const [fileAutoSave, setFileAutoSave] = createSignal(false);
  const [fileSaveDir, setFileSaveDir] = createSignal("");
  const [fileConfirmActions, setFileConfirmActions] = createSignal(true);
  const [audioFeedback, setAudioFeedback] = createSignal(true);
  const [incrementalInterval, setIncrementalInterval] = createSignal(5);
  const [maxParallelWorkers, setMaxParallelWorkers] = createSignal(2);
  const [autoCorrectionLlm, setAutoCorrectionLlm] = createSignal(false);
  const [meetingSaveDir, setMeetingSaveDir] = createSignal("");
  const [speakerDiarization, setSpeakerDiarization] = createSignal(false);
  const [floatingIndicator, setFloatingIndicator] = createSignal(true);
  const [soundPack, setSoundPack] = createSignal("retro");
  const [soundVolume, setSoundVolume] = createSignal(80);
  const [remoteServerEnabled, setRemoteServerEnabled] = createSignal(false);
  const [speakerProfiles, setSpeakerProfiles] = createSignal<string[]>([]);
  const [showVoiceTraining, setShowVoiceTraining] = createSignal(false);

  const [gpuInfo, setGpuInfo] = createSignal<{ available: boolean; name: string; vram_mb: number; driver: string; recommendation: string } | null>(null);
  const [gpuStatus, setGpuStatus] = createSignal<{ enabled: boolean; cuda_available: boolean; active: boolean; device_name: string } | null>(null);
  const [gpuLoading, setGpuLoading] = createSignal(false);

  const [key1, setKey1] = createSignal("CmdOrCtrl");
  const [key2, setKey2] = createSignal("Super");
  const [key3, setKey3] = createSignal("none");
  const [hotkeyMode, setHotkeyMode] = createSignal("hold");
  const [hotkeyDirty, setHotkeyDirty] = createSignal(false);

  const hotkey = () => buildHotkey(key1(), key2(), key3());

  onMount(async () => {
    // Mirror whatever the Rust store says about the current user, so the
    // "Use remote server" toggle below reflects reality even if
    // SettingsPanel opened before TitleBar mounted.
    initAuth();
    if (props.settings) {
      setLanguage(props.settings.language);
      setUseGpu(props.settings.use_gpu);
      setAutoPaste(props.settings.auto_paste);
      setAudioDevice(props.settings.audio_device);
      setFileAutoSave(props.settings.file_auto_save ?? false);
      setFileSaveDir(props.settings.file_save_directory ?? "");
      setFileConfirmActions(props.settings.file_confirm_actions ?? true);
      setAudioFeedback(props.settings.audio_feedback ?? true);
      setIncrementalInterval(props.settings.incremental_interval ?? 5);
      setMaxParallelWorkers(props.settings.max_parallel_workers ?? 2);
      setAutoCorrectionLlm(props.settings.auto_correction_llm ?? false);
      setMeetingSaveDir(props.settings.meeting_save_directory ?? "");
      setSpeakerDiarization(props.settings.speaker_diarization ?? false);
      setFloatingIndicator(props.settings.floating_indicator ?? true);
      setSoundPack(props.settings.sound_pack ?? "retro");
      setSoundVolume(props.settings.sound_volume ?? 80);
      setRemoteServerEnabled(props.settings.remote_server_enabled ?? false);
      const parsed = parseHotkey(props.settings.hotkey || "Ctrl+Super");
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
    try {
      const gpu = await api.getGpuInfo();
      setGpuInfo(gpu);
    } catch (_) {}
    try {
      const status = await api.getGpuStatus();
      setGpuStatus(status);
    } catch (_) {}
    try {
      const profiles = await api.listSpeakerProfiles();
      setSpeakerProfiles(profiles);
    } catch (_) {}
  });

  const refreshSpeakerProfiles = async () => {
    try {
      const profiles = await api.listSpeakerProfiles();
      setSpeakerProfiles(profiles);
    } catch (_) {}
  };

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
            <label>{t("settings.remoteServerEnabled")}</label>
            <div class="toggle-group">
              <label
                class="toggle"
                classList={{ "toggle-disabled": !isAuthenticated() }}
                title={!isAuthenticated() ? t("settings.remoteServerSignInHint") : ""}
              >
                <input
                  type="checkbox"
                  checked={isAuthenticated() && remoteServerEnabled()}
                  disabled={!isAuthenticated()}
                  onChange={(e) => {
                    if (!isAuthenticated()) {
                      // Can't happen while `disabled` is honored, but belt & braces.
                      (e.target as HTMLInputElement).checked = false;
                      return;
                    }
                    setRemoteServerEnabled(e.target.checked);
                    autoSave({ remote_server_enabled: e.target.checked });
                  }}
                />
                <span class="toggle-slider" />
              </label>
              <Show
                when={isAuthenticated()}
                fallback={
                  <span class="setting-hint">
                    {t("settings.remoteServerSignInHint")}{" "}
                    <button
                      class="setting-inline-btn"
                      onClick={async () => {
                        try {
                          const u = await auth.login();
                          setAuthUser(u);
                          // After a fresh sign-in, turn the toggle on so the
                          // user doesn't have to click it a second time —
                          // that's why they clicked Sign in in the first place.
                          setRemoteServerEnabled(true);
                          autoSave({ remote_server_enabled: true });
                        } catch (_) {
                          // user dismissed the browser flow; stay signed-out
                        }
                      }}
                    >
                      {t("settings.remoteServerSignInBtn")}
                    </button>
                  </span>
                }
              >
                <span class="setting-hint">{t("settings.remoteServerEnabledHint")}</span>
              </Show>
            </div>
          </div>

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
                api.updateTrayLanguage(newLang).catch(() => {});
              }}
            >
              <For each={availableLocales}>{(lang) =>
                <option value={lang}>{t(`languages.${lang}Full`)}</option>
              }</For>
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
                  onChange={async (e) => {
                    const val = e.target.checked;
                    setUseGpu(val);
                    autoSave({ use_gpu: val });
                    setGpuLoading(true);
                    // Reload model with new GPU setting
                    try {
                      const s = props.settings;
                      if (s?.model_path) {
                        await api.loadModel(s.model_path);
                      }
                      const status = await api.getGpuStatus();
                      setGpuStatus(status);
                    } catch (_) {}
                    setGpuLoading(false);
                  }}
                />
                <span class="toggle-slider" />
              </label>
              <span class="setting-hint">
                {useGpu() ? t("settings.gpuEnabled") : t("settings.gpuDisabled")}
              </span>
            </div>
            <Show when={gpuInfo()}>
              <div class={`gpu-info-card ${gpuInfo()!.available ? "gpu-available" : "gpu-unavailable"}`}>
                <div class="gpu-info-name">
                  <span class={`gpu-dot ${gpuInfo()!.available ? "green" : "gray"}`} />
                  {gpuInfo()!.name}
                </div>
                <Show when={gpuInfo()!.vram_mb > 0}>
                  <div class="gpu-info-detail">{t("settings.vram")}: {gpuInfo()!.vram_mb >= 1024 ? `${(gpuInfo()!.vram_mb / 1024).toFixed(1)} GB` : `${gpuInfo()!.vram_mb} MB`}</div>
                </Show>
                <Show when={gpuInfo()!.driver}>
                  <div class="gpu-info-detail">{t("settings.gpuDriver")}: {gpuInfo()!.driver}</div>
                </Show>
                <div class="gpu-info-recommendation">{gpuInfo()!.recommendation}</div>
              </div>
            </Show>
            <Show when={gpuStatus()}>
              <div class={`gpu-status-badge ${gpuStatus()!.active ? "gpu-active" : gpuStatus()!.enabled ? "gpu-pending" : "gpu-off"}`}>
                <Show when={gpuLoading()}>
                  <span class="gpu-status-icon">...</span>
                </Show>
                <Show when={!gpuLoading()}>
                  <Show when={gpuStatus()!.active}>
                    <span class="gpu-status-icon gpu-check">&#10003;</span>
                    <span>CUDA {t("settings.gpuStatusActive")}: {gpuStatus()!.device_name}</span>
                  </Show>
                  <Show when={!gpuStatus()!.active && gpuStatus()!.enabled}>
                    <span class="gpu-status-icon gpu-warn">!</span>
                    <span>{gpuStatus()!.cuda_available ? t("settings.gpuStatusNotDetected") : t("settings.gpuStatusNoCuda")}</span>
                  </Show>
                  <Show when={!gpuStatus()!.enabled}>
                    <span class="gpu-status-icon gpu-off-icon">&#9679;</span>
                    <span>{t("settings.gpuStatusOff")}</span>
                  </Show>
                </Show>
              </div>
            </Show>
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


          <div class="setting-row">
            <label>{t("settings.audioFeedback")}</label>
            <div class="toggle-group">
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={audioFeedback()}
                  onChange={(e) => { setAudioFeedback(e.target.checked); autoSave({ audio_feedback: e.target.checked }); }}
                />
                <span class="toggle-slider" />
              </label>
              <span class="setting-hint">
                {audioFeedback() ? t("settings.audioFeedbackEnabled") : t("settings.audioFeedbackDisabled")}
              </span>
            </div>
          </div>

          <div class="setting-row">
            <label>{t("settings.incrementalInterval")}</label>
            <div class="range-group">
              <input
                type="range"
                min="1" max="60" step="1"
                value={incrementalInterval()}
                onInput={(e) => { const v = parseInt(e.target.value, 10); setIncrementalInterval(v); autoSave({ incremental_interval: v }); }}
              />
              <span class="range-value">{incrementalInterval()}s</span>
            </div>
            <span class="setting-hint">{t("settings.incrementalIntervalHint")}</span>
          </div>

          <div class="setting-row">
            <label>{t("settings.maxParallelWorkers")}</label>
            <select
              value={maxParallelWorkers()}
              onChange={(e) => { const v = parseInt(e.target.value, 10); setMaxParallelWorkers(v); autoSave({ max_parallel_workers: v }); }}
            >
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
            <span class="setting-hint">{t("settings.maxParallelWorkersHint")}</span>
          </div>

          <div class="setting-row">
            <label>{t("settings.autoCorrectionLlm")}</label>
            <div class="toggle-group">
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={autoCorrectionLlm()}
                  onChange={(e) => { setAutoCorrectionLlm(e.target.checked); autoSave({ auto_correction_llm: e.target.checked }); }}
                />
                <span class="toggle-slider" />
              </label>
              <span class="setting-hint">{t("settings.autoCorrectionLlmHint")}</span>
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

          <div class="setting-row">
            <label>{t("settings.soundPack")}</label>
            <select value={soundPack()} onChange={(e) => { setSoundPack(e.target.value); autoSave({ sound_pack: e.target.value }); }}>
              <option value="retro">{t("settings.soundPackRetro")}</option>
              <option value="classic">{t("settings.soundPackClassic")}</option>
            </select>
          </div>

          <div class="setting-row">
            <label>{t("settings.soundVolume")}</label>
            <div class="range-group">
              <input
                type="range"
                min="0" max="100" step="1"
                value={soundVolume()}
                onInput={(e) => { const v = parseInt(e.target.value, 10); setSoundVolume(v); autoSave({ sound_volume: v }); }}
              />
              <span class="range-value">{soundVolume()}%</span>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>{t("settings.meetingSection")}</h3>

          <div class="setting-row">
            <label>{t("settings.meetingSaveDirectory")}</label>
            <div class="file-dir-picker">
              <input
                type="text"
                value={meetingSaveDir()}
                placeholder={t("settings.meetingSaveDirPlaceholder")}
                readOnly
              />
              <button
                class="btn btn-small"
                onClick={async () => {
                  try {
                    const { open } = await import("@tauri-apps/plugin-dialog");
                    const dir = await open({ directory: true });
                    if (dir) {
                      setMeetingSaveDir(dir as string);
                      autoSave({ meeting_save_directory: dir as string });
                    }
                  } catch (_) {}
                }}
              >
                {t("settings.fileSaveDirBrowse")}
              </button>
            </div>
            <span class="setting-hint">{t("settings.meetingSaveDirHint")}</span>
          </div>

          <div class="setting-row">
            <label>{t("settings.speakerDiarization")}</label>
            <div class="toggle-group">
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={speakerDiarization()}
                  onChange={(e) => { setSpeakerDiarization(e.target.checked); autoSave({ speaker_diarization: e.target.checked }); }}
                />
                <span class="toggle-slider" />
              </label>
              <span class="setting-hint">{t("settings.speakerDiarizationHint")}</span>
            </div>
          </div>

          <div class="setting-row">
            <label>{t("settings.floatingIndicator")}</label>
            <div class="toggle-group">
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={floatingIndicator()}
                  onChange={(e) => { setFloatingIndicator(e.target.checked); autoSave({ floating_indicator: e.target.checked }); }}
                />
                <span class="toggle-slider" />
              </label>
              <span class="setting-hint">{t("settings.floatingIndicatorHint")}</span>
            </div>
          </div>

          <div class="setting-row">
            <label>{t("settings.speakerProfiles")}</label>
            <div class="speaker-profiles-list">
              <For each={speakerProfiles()}>
                {(name) => (
                  <div class="speaker-profile-item">
                    <span class="speaker-profile-name">{name}</span>
                    <span class="speaker-trained-badge">{t("settings.speakerTrained")}</span>
                    <button
                      class="btn btn-small btn-danger-outline"
                      onClick={async () => {
                        try {
                          await api.deleteSpeakerProfile(name);
                          await refreshSpeakerProfiles();
                        } catch (_) {}
                      }}
                    >
                      {t("settings.speakerDelete")}
                    </button>
                  </div>
                )}
              </For>
              <Show when={speakerProfiles().length === 0}>
                <span class="setting-hint">{t("settings.speakerNoProfiles")}</span>
              </Show>
            </div>
            <button
              class="btn btn-small"
              style={{ "margin-top": "8px" }}
              onClick={() => setShowVoiceTraining(true)}
            >
              {t("settings.speakerNewProfile")}
            </button>
          </div>

          <Show when={showVoiceTraining()}>
            <VoiceTraining
              language={props.settings?.language ?? "nl"}
              onComplete={async () => {
                setShowVoiceTraining(false);
                await refreshSpeakerProfiles();
              }}
              onCancel={() => setShowVoiceTraining(false)}
            />
          </Show>
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
