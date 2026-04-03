/**
 * Audio feedback for dictation events.
 *
 * Primary: plays pre-generated 8-bit chiptune WAV files from /sounds/.
 * Fallback (classic): Web Audio API oscillator synthesis.
 *
 * Preference learning: tracks plays/likes per file; weighted random pick
 * causes liked files to appear more often, disliked ones to fade out.
 */

let audioCtx: AudioContext | null = null;
const soundBuffers: Map<string, AudioBuffer> = new Map();

const SOUND_PREF_KEY = 'oss_sound_prefs';

interface SoundPreference {
  file: string;
  likes: number;
  plays: number;
  weight: number;
}

let soundPrefs: Map<string, SoundPreference> = new Map();
let lastPlayedSound: string | null = null;

// ---------------------------------------------------------------------------
// AudioContext helpers
// ---------------------------------------------------------------------------

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// ---------------------------------------------------------------------------
// Preference persistence
// ---------------------------------------------------------------------------

function loadPrefs(): void {
  try {
    const raw = localStorage.getItem(SOUND_PREF_KEY);
    if (!raw) return;
    const arr: SoundPreference[] = JSON.parse(raw);
    soundPrefs = new Map(arr.map((p) => [p.file, p]));
  } catch {
    soundPrefs = new Map();
  }
}

function savePrefs(): void {
  try {
    const arr = Array.from(soundPrefs.values());
    localStorage.setItem(SOUND_PREF_KEY, JSON.stringify(arr));
  } catch {
    // localStorage may be unavailable in some Tauri contexts — silently ignore
  }
}

function getPref(file: string): SoundPreference {
  if (!soundPrefs.has(file)) {
    soundPrefs.set(file, { file, likes: 0, plays: 0, weight: 1.0 });
  }
  return soundPrefs.get(file)!;
}

// ---------------------------------------------------------------------------
// Weight algorithm
// ---------------------------------------------------------------------------

/**
 * Base weight: 1.0
 * Liked at least once:        1.0 + likes * 2.0
 * Never liked after 5+ plays: max(0.1, 1.0 - plays * 0.1)
 */
function computeWeight(pref: SoundPreference): number {
  if (pref.likes > 0) {
    return 1.0 + pref.likes * 2.0;
  }
  if (pref.plays >= 5) {
    return Math.max(0.1, 1.0 - pref.plays * 0.1);
  }
  return 1.0;
}

function getWeight(file: string): number {
  return computeWeight(getPref(file));
}

// ---------------------------------------------------------------------------
// Sound file catalogue
// ---------------------------------------------------------------------------

function getSoundFiles(category: 'success' | 'start' | 'error'): string[] {
  switch (category) {
    case 'success':
      return [
        '/sounds/success/coin.wav',
        '/sounds/success/power-up.wav',
        '/sounds/success/level-clear.wav',
        '/sounds/success/secret.wav',
        '/sounds/success/victory-fanfare.wav',
        '/sounds/success/star-collect.wav',
        '/sounds/success/gem-pickup.wav',
        '/sounds/success/checkpoint.wav',
      ];
    case 'start':
      return [
        '/sounds/start/blip-up.wav',
        '/sounds/start/ready.wav',
        '/sounds/start/ping.wav',
      ];
    case 'error':
      return [
        '/sounds/error/fail.wav',
        '/sounds/error/buzz.wav',
      ];
  }
}

// ---------------------------------------------------------------------------
// Buffer loading
// ---------------------------------------------------------------------------

async function loadSoundFile(path: string): Promise<AudioBuffer> {
  if (soundBuffers.has(path)) return soundBuffers.get(path)!;
  const ctx = getCtx();
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`Failed to fetch sound: ${path} (${resp.status})`);
  const arrayBuf = await resp.arrayBuffer();
  const audioBuf = await ctx.decodeAudioData(arrayBuf);
  soundBuffers.set(path, audioBuf);
  return audioBuf;
}

/** Pre-load all sound files for a category (fire-and-forget). */
function preloadCategory(category: 'success' | 'start' | 'error'): void {
  for (const file of getSoundFiles(category)) {
    loadSoundFile(file).catch(() => { /* ignore preload failures */ });
  }
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function playBuffer(buffer: AudioBuffer, volume = 0.7): void {
  const ctx = getCtx();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start();
}

// ---------------------------------------------------------------------------
// Weighted random selection
// ---------------------------------------------------------------------------

function weightedRandomPick(files: string[]): string {
  const weights = files.map(getWeight);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < files.length; i++) {
    r -= weights[i];
    if (r <= 0) return files[i];
  }
  return files[files.length - 1];
}

// ---------------------------------------------------------------------------
// Core play function
// ---------------------------------------------------------------------------

async function playCategorySound(
  category: 'success' | 'start' | 'error',
  volume = 0.7,
): Promise<void> {
  const files = getSoundFiles(category);
  const file = weightedRandomPick(files);
  lastPlayedSound = file;

  // Update play count
  const pref = getPref(file);
  pref.plays += 1;
  pref.weight = computeWeight(pref);
  savePrefs();

  try {
    const buffer = await loadSoundFile(file);
    playBuffer(buffer, volume);
  } catch (err) {
    console.warn('[sounds] Failed to play', file, err);
  }
}

// ---------------------------------------------------------------------------
// Public API — initialisation
// ---------------------------------------------------------------------------

/** Call once after any in-page user interaction to unlock the AudioContext. */
export function initSounds(): void {
  loadPrefs();
  const ctx = getCtx();
  if (ctx.state === 'suspended') ctx.resume();
  // Eagerly preload start sounds (most latency-sensitive)
  preloadCategory('start');
}

// ---------------------------------------------------------------------------
// Public API — playback
// ---------------------------------------------------------------------------

export function soundRecordStart(volume = 0.7): void {
  playCategorySound('start', volume);
}

export function soundRecordStop(_volume = 0.5): void {
  // No dedicated "stop" category — silence is fine; could add one later.
}

export function soundTranscriptionDone(volume = 0.7): void {
  playCategorySound('success', volume);
}

export function soundError(volume = 0.6): void {
  playCategorySound('error', volume);
}

// ---------------------------------------------------------------------------
// Public API — preference learning
// ---------------------------------------------------------------------------

/** Increment the like count for the last played sound. */
export function likeLastSound(): void {
  if (!lastPlayedSound) return;
  const pref = getPref(lastPlayedSound);
  pref.likes += 1;
  pref.weight = computeWeight(pref);
  savePrefs();
}

/** Return the filename of the last played sound (for display or testing). */
export function getLastPlayedSound(): string | null {
  return lastPlayedSound;
}

// ---------------------------------------------------------------------------
// Classic (legacy) synthesis — kept as fallback / "classic" sound pack
// ---------------------------------------------------------------------------

function getCtxClassic(): AudioContext {
  return getCtx();
}

export function soundRecordStartClassic(): void {
  const ctx = getCtxClassic();
  const osc = ctx.createOscillator();
  const vol = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(900, ctx.currentTime + 0.12);
  vol.gain.value = 0.3;
  vol.gain.setTargetAtTime(0, ctx.currentTime + 0.08, 0.03);
  osc.connect(vol);
  vol.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.15);
}

export function soundTranscriptionDoneClassic(): void {
  const ctx = getCtxClassic();
  const t = ctx.currentTime;
  const notes = [
    { freq: 523, start: 0, dur: 0.2 },
    { freq: 659, start: 0.1, dur: 0.2 },
    { freq: 784, start: 0.2, dur: 0.35 },
  ];
  for (const note of notes) {
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = note.freq;
    vol.gain.setValueAtTime(0, t + note.start);
    vol.gain.linearRampToValueAtTime(0.18, t + note.start + 0.02);
    vol.gain.setTargetAtTime(0, t + note.start + note.dur * 0.6, note.dur * 0.2);
    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.start(t + note.start);
    osc.stop(t + note.start + note.dur + 0.1);
  }
}

export function soundErrorClassic(): void {
  const ctx = getCtxClassic();
  const playTone = (freq: number, delay: number, duration: number) => {
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    vol.gain.value = 0.15;
    vol.gain.setTargetAtTime(0, ctx.currentTime + delay + duration * 0.7, duration * 0.15);
    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + duration);
  };
  playTone(220, 0, 0.25);
  playTone(180, 0.2, 0.3);
}
