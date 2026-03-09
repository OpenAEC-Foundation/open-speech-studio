import { createSignal, onMount, Show } from "solid-js";
import { api, type Settings } from "../lib/api";

interface SettingsPanelProps {
  settings: Settings | null;
  onSave: (settings: Settings) => void;
}

export default function SettingsPanel(props: SettingsPanelProps) {
  const [language, setLanguage] = createSignal("auto");
  const [useGpu, setUseGpu] = createSignal(false);
  const [hotkey, setHotkey] = createSignal("CmdOrCtrl+Shift+Space");
  const [autoPaste, setAutoPaste] = createSignal(true);
  const [audioDevice, setAudioDevice] = createSignal("default");
  const [devices, setDevices] = createSignal<string[]>([]);

  onMount(async () => {
    if (props.settings) {
      setLanguage(props.settings.language);
      setUseGpu(props.settings.use_gpu);
      setHotkey(props.settings.hotkey);
      setAutoPaste(props.settings.auto_paste);
      setAudioDevice(props.settings.audio_device);
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
      use_gpu: useGpu(),
      hotkey: hotkey(),
      auto_paste: autoPaste(),
      audio_device: audioDevice(),
    });
  };

  return (
    <div class="settings-panel">
      <h2>Instellingen</h2>

      <div class="settings-section">
        <h3>Spraakherkenning</h3>

        <div class="setting-row">
          <label>Taal</label>
          <select value={language()} onChange={(e) => setLanguage(e.target.value)}>
            <option value="auto">Automatisch detecteren</option>
            <option value="en">Engels (English)</option>
            <option value="nl">Nederlands (Dutch)</option>
            <option value="de">Duits (German)</option>
            <option value="fr">Frans (French)</option>
            <option value="es">Spaans (Spanish)</option>
            <option value="it">Italiaans (Italian)</option>
            <option value="pt">Portugees (Portuguese)</option>
            <option value="pl">Pools (Polish)</option>
            <option value="ja">Japans (Japanese)</option>
            <option value="zh">Chinees (Chinese)</option>
          </select>
        </div>

        <div class="setting-row">
          <label>GPU Versnelling</label>
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
                ? "GPU wordt gebruikt (CUDA/Vulkan vereist)"
                : "CPU modus - werkt overal, maar langzamer"}
            </span>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3>Bediening</h3>

        <div class="setting-row">
          <label>Sneltoets</label>
          <input
            type="text"
            value={hotkey()}
            onInput={(e) => setHotkey(e.target.value)}
            placeholder="bijv. CmdOrCtrl+Shift+Space"
          />
        </div>

        <div class="setting-row">
          <label>Automatisch plakken</label>
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
              Tekst automatisch typen na transcriptie
            </span>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3>Audio</h3>

        <div class="setting-row">
          <label>Invoerapparaat</label>
          <select value={audioDevice()} onChange={(e) => setAudioDevice(e.target.value)}>
            <option value="default">Standaard microfoon</option>
            {devices().map((d) => (
              <option value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      <div class="settings-actions">
        <button class="btn btn-primary" onClick={handleSave}>
          Opslaan
        </button>
      </div>
    </div>
  );
}
