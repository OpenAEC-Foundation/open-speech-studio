import { createSignal, onMount, Show } from "solid-js";
import { api, type Settings } from "../lib/api";

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
  { group: "Modifiers", keys: [
    { value: "CmdOrCtrl", label: "Ctrl / Cmd" },
    { value: "Super", label: "Win / Super" },
    { value: "Alt", label: "Alt" },
    { value: "Shift", label: "Shift" },
  ]},
  { group: "Speciale toetsen", keys: [
    { value: "Space", label: "Space" },
    { value: "Enter", label: "Enter" },
    { value: "Tab", label: "Tab" },
    { value: "Escape", label: "Escape" },
  ]},
  { group: "Letters", keys: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => ({ value: l, label: l })) },
  { group: "Cijfers", keys: "0123456789".split("").map((n) => ({ value: n, label: n })) },
  { group: "Functietoetsen", keys: Array.from({ length: 12 }, (_, i) => ({ value: `F${i + 1}`, label: `F${i + 1}` })) },
];

export default function SettingsPanel(props: SettingsPanelProps) {
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

      const parsed = parseHotkey(props.settings.hotkey || "CmdOrCtrl+Super");
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
          <label>Sneltoets (2 of 3 toetsen)</label>
          <div class="hotkey-builder">
            {/* Toets 1 — altijd verplicht */}
            <select value={key1()} onChange={(e) => setKey1(e.target.value)}>
              {ALL_KEYS.map((group) => (
                <optgroup label={group.group}>
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
                <optgroup label={group.group}>
                  {group.keys.map((k) => (
                    <option value={k.value}>{k.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span class="hotkey-plus">+</span>
            {/* Toets 3 — optioneel */}
            <select value={key3()} onChange={(e) => setKey3(e.target.value)}>
              <option value="none">Geen (2 toetsen)</option>
              {ALL_KEYS.map((group) => (
                <optgroup label={group.group}>
                  {group.keys.map((k) => (
                    <option value={k.value}>{k.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <span class="setting-hint">Huidige sneltoets: <kbd class="hotkey-preview">{hotkey()}</kbd></span>
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
