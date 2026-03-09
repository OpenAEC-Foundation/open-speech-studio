import { invoke } from "@tauri-apps/api/core";

export interface Settings {
  language: string;
  model_name: string;
  model_path: string;
  use_gpu: boolean;
  hotkey: string;
  auto_paste: boolean;
  audio_device: string;
  theme: string;
}

export interface ModelInfo {
  name: string;
  size: string;
  downloaded: boolean;
  path: string | null;
}

export interface TranscriptionResult {
  text: string;
  language: string;
  duration_ms: number;
}

export interface Dictionary {
  words: Record<string, string | null>;
}

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { newSettings: settings }),

  getAvailableModels: () => invoke<ModelInfo[]>("get_available_models"),
  downloadModel: (modelName: string) => invoke<string>("download_model", { modelName }),
  loadModel: (modelPath: string) => invoke<void>("load_model", { modelPath }),

  startRecording: () => invoke<void>("start_recording"),
  stopRecording: () => invoke<TranscriptionResult>("stop_recording"),
  getRecordingStatus: () => invoke<boolean>("get_recording_status"),

  getDictionary: () => invoke<Dictionary>("get_dictionary"),
  saveDictionary: (dict: Dictionary) => invoke<void>("save_dictionary", { dict }),
  addDictionaryWord: (word: string, replacement: string | null) =>
    invoke<void>("add_dictionary_word", { word, replacement }),
  removeDictionaryWord: (word: string) => invoke<void>("remove_dictionary_word", { word }),

  getAudioDevices: () => invoke<string[]>("get_audio_devices"),
  typeText: (text: string) => invoke<void>("type_text", { text }),
};
