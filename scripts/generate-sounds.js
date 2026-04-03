/**
 * generate-sounds.js
 * Synthesizes 8-bit chiptune WAV files for Open Speech Studio.
 * No external dependencies — pure Node.js Buffer math.
 *
 * Usage: node scripts/generate-sounds.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SAMPLE_RATE = 22050;
const BIT_DEPTH = 16;
const NUM_CHANNELS = 1;

// ---------------------------------------------------------------------------
// WAV writer
// ---------------------------------------------------------------------------
function writeWav(filename, sampleRate, samples) {
  const numSamples = samples.length;
  const byteRate = sampleRate * NUM_CHANNELS * (BIT_DEPTH / 8);
  const blockAlign = NUM_CHANNELS * (BIT_DEPTH / 8);
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const buf = Buffer.alloc(headerSize + dataSize);

  // RIFF chunk
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');

  // fmt sub-chunk
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);          // sub-chunk size
  buf.writeUInt16LE(1, 20);           // PCM = 1
  buf.writeUInt16LE(NUM_CHANNELS, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(BIT_DEPTH, 34);

  // data sub-chunk
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);

  const MAX_INT16 = 32767;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(clamped * MAX_INT16), headerSize + i * 2);
  }

  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, buf);
  console.log(`  wrote ${path.relative(process.cwd(), filename)}  (${numSamples} samples)`);
}

// ---------------------------------------------------------------------------
// Synthesis helpers
// ---------------------------------------------------------------------------

/** Square wave at given frequency for given duration (seconds). */
function squareTone(freq, duration, amplitude = 0.4, sampleRate = SAMPLE_RATE) {
  const n = Math.round(sampleRate * duration);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const phase = (i * freq / sampleRate) % 1;
    samples[i] = amplitude * (phase < 0.5 ? 1 : -1);
  }
  return samples;
}

/** Linearly interpolated frequency sweep (square wave). */
function squareSweep(freqStart, freqEnd, duration, amplitude = 0.4, sampleRate = SAMPLE_RATE) {
  const n = Math.round(sampleRate * duration);
  const samples = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const freq = freqStart + (freqEnd - freqStart) * t;
    phase += freq / sampleRate;
    samples[i] = amplitude * ((phase % 1) < 0.5 ? 1 : -1);
  }
  return samples;
}

/** Concatenate multiple Float32Arrays. */
function concat(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/** Apply a simple amplitude envelope (attack + decay).
 *  attackFrac: fraction of length for linear rise.
 *  decayFrac:  fraction of length for linear fall.
 */
function envelope(samples, attackFrac = 0.05, decayFrac = 0.3) {
  const n = samples.length;
  const out = new Float32Array(n);
  const attackEnd = Math.round(n * attackFrac);
  const decayStart = Math.round(n * (1 - decayFrac));
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (i < attackEnd) env = i / attackEnd;
    else if (i >= decayStart) env = 1 - (i - decayStart) / (n - decayStart);
    out[i] = samples[i] * env;
  }
  return out;
}

/** Scale amplitude. */
function scale(samples, factor) {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * factor;
  return out;
}

/** Mix two equal-length arrays. */
function mix(a, b) {
  const n = Math.max(a.length, b.length);
  const out = new Float32Array(n);
  for (let i = 0; i < a.length; i++) out[i] += a[i];
  for (let i = 0; i < b.length; i++) out[i] += b[i];
  return out;
}

/** Silence gap in seconds. */
function silence(duration, sampleRate = SAMPLE_RATE) {
  return new Float32Array(Math.round(sampleRate * duration));
}

// Note frequencies (Hz) — equal temperament, A4 = 440
const NOTE = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
  C6: 1046.50, D6: 1174.66, E6: 1318.51, F6: 1396.91, G6: 1567.98,
};

// ---------------------------------------------------------------------------
// Sound definitions
// ---------------------------------------------------------------------------

const OUT = path.resolve(__dirname, '..', 'public', 'sounds');

const sounds = [
  // ── SUCCESS ──────────────────────────────────────────────────────────────
  {
    file: `${OUT}/success/coin.wav`,
    build() {
      // Classic Mario-style coin: B5 → E6 quick sweep
      const s = envelope(squareSweep(NOTE.B5, NOTE.E6, 0.12, 0.45), 0.01, 0.5);
      const tail = envelope(squareTone(NOTE.E6, 0.25, 0.35), 0.01, 0.6);
      return concat(s, tail);
    },
  },
  {
    file: `${OUT}/success/power-up.wav`,
    build() {
      // Rising sweep 200 → 1000 Hz
      return envelope(squareSweep(200, 1000, 0.6, 0.4), 0.02, 0.35);
    },
  },
  {
    file: `${OUT}/success/level-clear.wav`,
    build() {
      // C5 → E5 → G5 → C6 arpeggio, 0.12s per note
      const noteDur = 0.12;
      const notes = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6];
      const parts = notes.map((f, i) => {
        const amp = i === notes.length - 1 ? 0.4 : 0.35;
        return envelope(squareTone(f, noteDur, amp), 0.05, 0.3);
      });
      return concat(...parts);
    },
  },
  {
    file: `${OUT}/success/secret.wav`,
    build() {
      // Twinkle ascending arpeggio with gap
      const notes = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6];
      const parts = [];
      for (const f of notes) {
        parts.push(envelope(squareTone(f, 0.07, 0.38), 0.05, 0.4));
        parts.push(silence(0.02));
      }
      return concat(...parts);
    },
  },
  {
    file: `${OUT}/success/victory-fanfare.wav`,
    build() {
      // Short fanfare: G5-G5-G5-C6 (staccato) then long E6-D6-C6
      const staccato = [NOTE.G5, NOTE.G5, NOTE.G5];
      const legato = [NOTE.C6, NOTE.E6, NOTE.D6, NOTE.C6];
      const parts = [];
      for (const f of staccato) {
        parts.push(envelope(squareTone(f, 0.08, 0.4), 0.02, 0.4));
        parts.push(silence(0.02));
      }
      parts.push(silence(0.04));
      for (let i = 0; i < legato.length; i++) {
        const dur = i === legato.length - 1 ? 0.3 : 0.12;
        parts.push(envelope(squareTone(legato[i], dur, 0.4), 0.02, 0.35));
      }
      return concat(...parts);
    },
  },
  {
    file: `${OUT}/success/star-collect.wav`,
    build() {
      // Rapid ascending sweep then sparkle
      const sweep = envelope(squareSweep(400, 1400, 0.15, 0.4), 0.01, 0.3);
      const sparkle = envelope(squareTone(NOTE.E6, 0.2, 0.3), 0.02, 0.5);
      return concat(sweep, sparkle);
    },
  },
  {
    file: `${OUT}/success/gem-pickup.wav`,
    build() {
      // Two-note chime: D5 → A5
      const n1 = envelope(squareTone(NOTE.D5, 0.1, 0.38), 0.03, 0.4);
      const n2 = envelope(squareTone(NOTE.A5, 0.28, 0.35), 0.03, 0.55);
      return concat(n1, n2);
    },
  },
  {
    file: `${OUT}/success/checkpoint.wav`,
    build() {
      // G5 → C6 → E6 arpeggio (checkpoint flag sound)
      const parts = [NOTE.G5, NOTE.C6, NOTE.E6].map((f, i) =>
        envelope(squareTone(f, i === 2 ? 0.25 : 0.09, 0.38), 0.03, 0.4)
      );
      return concat(...parts);
    },
  },

  // ── START ─────────────────────────────────────────────────────────────────
  {
    file: `${OUT}/start/blip-up.wav`,
    build() {
      return envelope(squareSweep(400, 1000, 0.15, 0.4), 0.02, 0.4);
    },
  },
  {
    file: `${OUT}/start/ready.wav`,
    build() {
      // Two ascending blips
      const b1 = envelope(squareTone(NOTE.C5, 0.08, 0.35), 0.03, 0.4);
      const b2 = envelope(squareTone(NOTE.G5, 0.12, 0.38), 0.03, 0.4);
      return concat(b1, silence(0.03), b2);
    },
  },
  {
    file: `${OUT}/start/ping.wav`,
    build() {
      return envelope(squareTone(NOTE.A5, 0.18, 0.38), 0.02, 0.6);
    },
  },

  // ── ERROR ─────────────────────────────────────────────────────────────────
  {
    file: `${OUT}/error/fail.wav`,
    build() {
      // Falling sweep 300 → 150 Hz
      return envelope(squareSweep(300, 150, 0.4, 0.38), 0.01, 0.3);
    },
  },
  {
    file: `${OUT}/error/buzz.wav`,
    build() {
      // Double low buzz
      const b1 = envelope(squareTone(220, 0.18, 0.38), 0.01, 0.25);
      const b2 = envelope(squareTone(180, 0.22, 0.35), 0.01, 0.3);
      return concat(b1, silence(0.04), b2);
    },
  },
];

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------
console.log('Generating chiptune WAV files...\n');
for (const sound of sounds) {
  const samples = sound.build();
  writeWav(sound.file, SAMPLE_RATE, samples);
}
console.log(`\nDone! ${sounds.length} files written to ${OUT}/`);
