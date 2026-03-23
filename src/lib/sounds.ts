/**
 * Audio feedback for dictation events.
 * Uses the Web Audio API to generate short tones — no external files needed.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  // Resume if suspended (happens when no prior user gesture in the webview)
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

/** Call once after any in-page user interaction to unlock the AudioContext.
 *  After that, global hotkeys can also produce sound. */
export function initSounds() {
  const ctx = getCtx();
  if (ctx.state === "suspended") ctx.resume();
}

function playTone(freq: number, duration: number, type: OscillatorType = "sine", gain = 0.25) {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const vol = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  vol.gain.value = gain;
  // Fade out to avoid click
  vol.gain.setTargetAtTime(0, ctx.currentTime + duration * 0.7, duration * 0.15);
  osc.connect(vol);
  vol.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

/** Short rising blip — recording started (key pressed) */
export function soundRecordStart() {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const vol = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(600, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(900, ctx.currentTime + 0.12);
  vol.gain.value = 0.3;
  vol.gain.setTargetAtTime(0, ctx.currentTime + 0.08, 0.03);
  osc.connect(vol);
  vol.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.15);
}

/** Short falling blip — recording stopped (key released) */
export function soundRecordStop() {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const vol = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(900, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.12);
  vol.gain.value = 0.3;
  vol.gain.setTargetAtTime(0, ctx.currentTime + 0.08, 0.03);
  osc.connect(vol);
  vol.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.15);
}

/** Pleasant three-note major chord chime — transcription done */
export function soundTranscriptionDone() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  // C5 → E5 → G5 (major triad, ascending)
  const notes = [
    { freq: 523, start: 0, dur: 0.2 },
    { freq: 659, start: 0.1, dur: 0.2 },
    { freq: 784, start: 0.2, dur: 0.35 },
  ];

  for (const note of notes) {
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = "sine";
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

/** Low buzz — error */
export function soundError() {
  playTone(220, 0.25, "square", 0.15);
  setTimeout(() => playTone(180, 0.3, "square", 0.12), 200);
}
