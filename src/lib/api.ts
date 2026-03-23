export interface Settings {
  language: string;
  ui_language: string;
  model_name: string;
  model_path: string;
  use_gpu: boolean;
  hotkey: string;
  hotkey_mode: string;
  auto_paste: boolean;
  audio_device: string;
  theme: string;
  file_auto_save: boolean;
  file_save_directory: string;
  file_confirm_actions: boolean;
  spell_check: boolean;
}

export interface ModelInfo {
  name: string;
  size: string;
  downloaded: boolean;
  path: string | null;
}

export interface TranscriptionResult {
  text: string;
  original_text?: string;
  language: string;
  duration_ms: number;
}

export interface Dictionary {
  words: Record<string, string | null>;
}

// Detect if we're running inside Tauri or in a plain browser
const isTauri = !!(window as any).__TAURI_INTERNALS__;

// ─── Tauri backend ───────────────────────────────────────────

let invoke: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null = null;

const invokeReady: Promise<void> = isTauri
  ? import("@tauri-apps/api/core").then((mod) => {
      invoke = mod.invoke;
    })
  : Promise.resolve();

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  await invokeReady;
  if (invoke) return invoke<T>(cmd, args);
  return Promise.reject(new Error(`Tauri not available — "${cmd}" cannot be called`));
}

const tauriApi = {
  getSettings: () => tauriInvoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => tauriInvoke<void>("save_settings", { newSettings: settings }),
  getAvailableModels: () => tauriInvoke<ModelInfo[]>("get_available_models"),
  downloadModel: (modelName: string) => tauriInvoke<string>("download_model", { modelName }),
  deleteModel: (modelName: string) => tauriInvoke<void>("delete_model", { modelName }),
  loadModel: (modelPath: string) => tauriInvoke<void>("load_model", { modelPath }),
  startRecording: () => tauriInvoke<void>("start_recording"),
  stopRecording: () => tauriInvoke<TranscriptionResult>("stop_recording"),
  getRecordingStatus: () => tauriInvoke<boolean>("get_recording_status"),
  getDictionary: () => tauriInvoke<Dictionary>("get_dictionary"),
  saveDictionary: (dict: Dictionary) => tauriInvoke<void>("save_dictionary", { dict }),
  addDictionaryWord: (word: string, replacement: string | null) =>
    tauriInvoke<void>("add_dictionary_word", { word, replacement }),
  removeDictionaryWord: (word: string) => tauriInvoke<void>("remove_dictionary_word", { word }),
  getAudioDevices: () => tauriInvoke<string[]>("get_audio_devices"),
  getAudioLevel: () => tauriInvoke<number>("get_audio_level"),
  isModelLoaded: () => tauriInvoke<boolean>("is_model_loaded"),
  getGpuInfo: () => tauriInvoke<{ available: boolean; name: string; vram_mb: number; driver: string; recommendation: string }>("get_gpu_info"),
  typeText: (text: string) => tauriInvoke<void>("type_text", { text }),
  startFileJob: (jobId: string, filePath: string) =>
    tauriInvoke<void>("start_file_job", { jobId, filePath }),
  cancelFileJob: (jobId: string) =>
    tauriInvoke<void>("cancel_file_job", { jobId }),
};

// ─── Local server detection ──────────────────────────────────

const SERVER_URL = "http://localhost:3333";
let serverAvailable: boolean | null = null; // null = not checked yet

async function checkServer(): Promise<boolean> {
  if (serverAvailable !== null) return serverAvailable;
  try {
    const res = await fetch(`${SERVER_URL}/api/status`, { signal: AbortSignal.timeout(1500) });
    const data = await res.json();
    serverAvailable = data.status === "ok";
  } catch {
    serverAvailable = false;
  }
  // Re-check every 30 seconds
  setTimeout(() => { serverAvailable = null; }, 30000);
  return serverAvailable;
}

export function isServerMode(): boolean {
  return serverAvailable === true;
}

// ─── Browser backend (local server → Web Speech API fallback) ─

const SETTINGS_KEY = "oss_settings";
const DICT_KEY = "oss_dictionary";

function loadLocalSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return {
    language: "nl",
    ui_language: "en",
    model_name: "base",
    model_path: "",
    use_gpu: false,
    hotkey: "Ctrl+Super",
    hotkey_mode: "hold",
    auto_paste: true,
    audio_device: "default",
    theme: "dark",
    file_auto_save: false,
    file_save_directory: "",
    file_confirm_actions: true,
    spell_check: true,
  };
}

function saveLocalSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function loadLocalDictionary(): Dictionary {
  try {
    const raw = localStorage.getItem(DICT_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { words: {} };
}

function saveLocalDictionary(d: Dictionary) {
  localStorage.setItem(DICT_KEY, JSON.stringify(d));
}

let currentSettings = loadLocalSettings();
let currentDict = loadLocalDictionary();

// Audio capture state
let micStream: MediaStream | null = null;
let micAnalyser: AnalyserNode | null = null;
let micAudioCtx: AudioContext | null = null;
let pcmBuffers: Float32Array[] = [];
let scriptNode: ScriptProcessorNode | null = null;
let isServerRecording = false;

// Web Speech API state (fallback)
let recognition: any = null;
let recognizedText = "";
let recordingStartTime = 0;

export function getMicAnalyser(): AnalyserNode | null {
  return micAnalyser;
}

export function isBrowserMode(): boolean {
  return !isTauri;
}

function applyDictionary(text: string): string {
  let result = text;
  for (const [word, replacement] of Object.entries(currentDict.words)) {
    if (replacement) {
      const regex = new RegExp(`\\b${word}\\b`, "gi");
      result = result.replace(regex, replacement);
    }
  }
  return result;
}

function getSpeechLang(lang: string): string {
  const map: Record<string, string> = {
    auto: "", nl: "nl-NL", en: "en-US", de: "de-DE", fr: "fr-FR",
    es: "es-ES", it: "it-IT", pt: "pt-PT", pl: "pl-PL", ja: "ja-JP", zh: "zh-CN",
  };
  return map[lang] || "";
}

// ─── Start mic + analyser (shared for both modes) ────────────

async function startMic() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  micAudioCtx = new AudioContext();
  const source = micAudioCtx.createMediaStreamSource(micStream);
  micAnalyser = micAudioCtx.createAnalyser();
  micAnalyser.fftSize = 256;
  source.connect(micAnalyser);
}

function stopMic() {
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (micAudioCtx) {
    micAudioCtx.close();
    micAudioCtx = null;
  }
  micAnalyser = null;
}

// ─── Server-based recording (local Whisper) ──────────────────

async function startServerRecording() {
  await startMic();
  pcmBuffers = [];
  isServerRecording = true;
  recordingStartTime = Date.now();

  // Capture raw PCM directly via ScriptProcessorNode (no MediaRecorder/webm needed)
  scriptNode = micAudioCtx!.createScriptProcessor(4096, 1, 1);
  const source = micAudioCtx!.createMediaStreamSource(micStream!);
  scriptNode.onaudioprocess = (e) => {
    if (!isServerRecording) return;
    const input = e.inputBuffer.getChannelData(0);
    pcmBuffers.push(new Float32Array(input));
  };
  source.connect(scriptNode);
  scriptNode.connect(micAudioCtx!.destination);
}

async function stopServerRecording(): Promise<TranscriptionResult> {
  const durationMs = Date.now() - recordingStartTime;
  isServerRecording = false;

  // Disconnect script node
  if (scriptNode) {
    scriptNode.disconnect();
    scriptNode = null;
  }

  // Merge all PCM buffers
  const totalLength = pcmBuffers.reduce((sum, buf) => sum + buf.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const buf of pcmBuffers) {
    merged.set(buf, offset);
    offset += buf.length;
  }
  pcmBuffers = [];

  // Resample from micAudioCtx.sampleRate to 16kHz
  const srcRate = micAudioCtx?.sampleRate || 48000;
  const targetRate = 16000;
  const ratio = srcRate / targetRate;
  const resampledLength = Math.floor(merged.length / ratio);
  const pcm16 = new Int16Array(resampledLength);
  for (let i = 0; i < resampledLength; i++) {
    const srcIdx = Math.floor(i * ratio);
    const s = Math.max(-1, Math.min(1, merged[srcIdx]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  // Build WAV file
  const wavBuffer = createWavBuffer(pcm16, targetRate);

  stopMic();

  // Send to local server
  const res = await fetch(`${SERVER_URL}/api/transcribe?lang=${currentSettings.language}`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: wavBuffer,
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Transcriptie mislukt");
  }

  const result = await res.json();
  let text = (result.text || "").trim();
  text = applyDictionary(text);

  return { text, language: result.language || "auto", duration_ms: durationMs };
}

function createWavBuffer(pcm16: Int16Array, sampleRate: number): ArrayBuffer {
  const dataLen = pcm16.length * 2;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeString(view, 8, "WAVE");
  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataLen, true);

  const output = new Int16Array(buffer, 44);
  output.set(pcm16);

  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ─── Web Speech API recording (fallback) ─────────────────────

async function startWebSpeechRecording() {
  await startMic();

  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    throw new Error("Spraakherkenning niet beschikbaar. Start de lokale server: node server.js");
  }

  return new Promise<void>((resolve, reject) => {
    recognizedText = "";
    recordingStartTime = Date.now();

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    const lang = getSpeechLang(currentSettings.language);
    if (lang) recognition.lang = lang;

    recognition.onresult = (event: any) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      recognizedText = final || interim;
    };

    recognition.onerror = (event: any) => {
      if (event.error === "not-allowed") {
        reject(new Error("Microfoon toegang geweigerd."));
      }
    };

    recognition.onstart = () => resolve();

    try {
      recognition.start();
    } catch (e) {
      reject(new Error(`Spraakherkenning starten mislukt: ${e}`));
    }
  });
}

async function stopWebSpeechRecording(): Promise<TranscriptionResult> {
  const durationMs = Date.now() - recordingStartTime;

  if (recognition) {
    recognition.stop();
    await new Promise((r) => setTimeout(r, 300));
    recognition = null;
  }

  stopMic();

  let text = recognizedText.trim();
  text = applyDictionary(text);

  return { text, language: currentSettings.language || "auto", duration_ms: durationMs };
}

// ─── Browser API (auto-detects local server) ─────────────────

const browserApi = {
  getSettings: () => Promise.resolve({ ...currentSettings }),

  saveSettings: (settings: Settings) => {
    currentSettings = { ...settings };
    saveLocalSettings(settings);
    return Promise.resolve();
  },

  getAvailableModels: async (): Promise<ModelInfo[]> => {
    if (await checkServer()) {
      try {
        const res = await fetch(`${SERVER_URL}/api/models`);
        const data = await res.json();
        return data.models.map((m: any) => ({
          name: m.name,
          size: m.size,
          downloaded: m.downloaded,
          path: m.path,
        }));
      } catch (_) {}
    }
    // Fallback: show static list
    return [
      { name: "tiny", size: "~75 MB", downloaded: false, path: null },
      { name: "base", size: "~142 MB", downloaded: false, path: null },
      { name: "small", size: "~466 MB", downloaded: false, path: null },
      { name: "medium", size: "~1.5 GB", downloaded: false, path: null },
      { name: "large-v3-turbo", size: "~1.6 GB", downloaded: false, path: null },
      { name: "large-v3", size: "~3.1 GB", downloaded: false, path: null },
    ];
  },

  downloadModel: (_modelName: string) =>
    Promise.reject(new Error("Model download is not available in browser mode. Place .bin files manually in the models/ folder.")),

  deleteModel: (_modelName: string) =>
    Promise.reject(new Error("Model deletion is not available in browser mode.")),

  loadModel: async (modelPath: string) => {
    if (await checkServer()) {
      const name = modelPath.replace(/^.*ggml-/, "").replace(/\.bin$/, "");
      const res = await fetch(`${SERVER_URL}/api/load-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      currentSettings.model_name = name;
      currentSettings.model_path = modelPath;
      saveLocalSettings(currentSettings);
    }
  },

  startRecording: async () => {
    try {
      if (await checkServer()) {
        return startServerRecording();
      }
    } catch (_) {
      // Server failed, fall through to Web Speech
    }
    return startWebSpeechRecording();
  },

  stopRecording: async (): Promise<TranscriptionResult> => {
    if (isServerRecording) {
      return stopServerRecording();
    }
    return stopWebSpeechRecording();
  },

  getRecordingStatus: () => Promise.resolve(recognition !== null || isServerRecording),

  getDictionary: () => Promise.resolve({ ...currentDict }),

  saveDictionary: (dict: Dictionary) => {
    currentDict = { ...dict };
    saveLocalDictionary(dict);
    return Promise.resolve();
  },

  addDictionaryWord: (word: string, replacement: string | null) => {
    currentDict.words[word] = replacement;
    saveLocalDictionary(currentDict);
    return Promise.resolve();
  },

  removeDictionaryWord: (word: string) => {
    delete currentDict.words[word];
    saveLocalDictionary(currentDict);
    return Promise.resolve();
  },

  getAudioLevel: () => Promise.resolve(0),

  getAudioDevices: async () => {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach((t) => t.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === "audioinput")
        .map((d) => d.label || `Microfoon ${d.deviceId.slice(0, 8)}`);
    } catch {
      return ["Standaard microfoon"];
    }
  },

  isModelLoaded: async () => {
    if (await checkServer()) {
      try {
        const res = await fetch(`${SERVER_URL}/api/status`);
        const data = await res.json();
        return data.modelLoaded === true;
      } catch (_) {}
    }
    // Fallback: check Web Speech API
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    return !!SR;
  },

  typeText: (_text: string) => Promise.resolve(),
  getGpuInfo: () => Promise.resolve({ available: false, name: "Not available in browser mode", vram_mb: 0, driver: "", recommendation: "GPU detection requires the desktop app" }),
  startFileJob: (_jobId: string, _filePath: string) =>
    Promise.reject(new Error("File transcription is not available in browser mode.")),
  cancelFileJob: (_jobId: string) =>
    Promise.reject(new Error("File transcription is not available in browser mode.")),
};

export const api = isTauri ? tauriApi : browserApi;
