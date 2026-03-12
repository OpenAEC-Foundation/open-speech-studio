import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { api, type TranscriptionResult, getMicAnalyser } from "../lib/api";

export default function MicTest() {
  const [devices, setDevices] = createSignal<string[]>([]);
  const [selectedDevice, setSelectedDevice] = createSignal("default");
  const [isTesting, setIsTesting] = createSignal(false);
  const [micLevel, setMicLevel] = createSignal(0);
  const [waveform, setWaveform] = createSignal<number[]>(new Array(40).fill(4));
  const [testResult, setTestResult] = createSignal<TranscriptionResult | null>(null);
  const [status, setStatus] = createSignal<{ type: "info" | "success" | "error"; text: string } | null>(null);
  const [isModelLoaded, setIsModelLoaded] = createSignal(false);
  let animFrame: number | null = null;

  onMount(async () => {
    try {
      const devs = await api.getAudioDevices();
      setDevices(devs);
    } catch (e) {
      console.error("Failed to get audio devices:", e);
    }

    try {
      const loaded = await api.isModelLoaded();
      setIsModelLoaded(loaded);
    } catch (_) {}
  });

  onCleanup(() => {
    if (animFrame) cancelAnimationFrame(animFrame);
  });

  // Real waveform animation using Web Audio API analyser
  const startWaveformAnimation = () => {
    const animate = () => {
      if (!isTesting()) return;

      const analyser = getMicAnalyser();
      if (analyser) {
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);

        // Calculate RMS level
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        setMicLevel(Math.min(100, (avg / 128) * 100));

        // Build waveform from frequency data
        const bars = 40;
        const step = Math.floor(dataArray.length / bars);
        const newWaveform: number[] = [];
        for (let i = 0; i < bars; i++) {
          const value = dataArray[i * step] || 0;
          newWaveform.push(4 + (value / 255) * 60);
        }
        setWaveform(newWaveform);
      } else {
        // Fallback: simulated animation
        setWaveform((prev) => {
          const next = [...prev];
          next.shift();
          next.push(4 + Math.random() * 40);
          return next;
        });
        setMicLevel(20 + Math.random() * 60);
      }

      animFrame = requestAnimationFrame(animate);
    };
    animFrame = requestAnimationFrame(animate);
  };

  const stopWaveformAnimation = () => {
    if (animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
    setWaveform(new Array(40).fill(4));
    setMicLevel(0);
  };

  const startTest = async () => {
    setTestResult(null);
    setStatus({ type: "info", text: "Microfoon test gestart — spreek iets in..." });

    try {
      await api.startRecording();
      setIsTesting(true);
      startWaveformAnimation();
    } catch (e) {
      setStatus({ type: "error", text: `Kan microfoon niet openen: ${e}` });
    }
  };

  const stopTest = async () => {
    stopWaveformAnimation();
    setIsTesting(false);

    if (!isModelLoaded()) {
      setStatus({ type: "info", text: "Audio opgenomen. Laad een model om de transcriptie te testen." });
      try {
        await api.stopRecording();
      } catch (_) {}
      return;
    }

    setStatus({ type: "info", text: "Transcriberen..." });
    try {
      const result = await api.stopRecording();
      setTestResult(result);

      if (result.text && result.text.trim().length > 0) {
        setStatus({ type: "success", text: `Microfoon werkt! Transcriptie in ${result.duration_ms}ms.` });
      } else {
        setStatus({ type: "error", text: "Geen spraak gedetecteerd. Controleer je microfoon en spreek luider." });
      }
    } catch (e) {
      setStatus({ type: "error", text: `Test mislukt: ${e}` });
    }
  };

  const getLevelClass = () => {
    const level = micLevel();
    if (level < 20) return "low";
    if (level < 70) return "good";
    return "hot";
  };

  return (
    <div class="mic-test">
      <h2>Microfoon Test</h2>
      <p class="section-description">
        Test je microfoon en controleer of de spraakherkenning correct werkt.
        Spreek een zin in en bekijk het resultaat.
      </p>

      <div class="mic-test-card">
        <h3>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          </svg>
          Invoerapparaat
        </h3>

        <select
          class="mic-select"
          value={selectedDevice()}
          onChange={(e) => setSelectedDevice(e.target.value)}
        >
          <option value="default">Standaard microfoon</option>
          {devices().map((d) => (
            <option value={d}>{d}</option>
          ))}
        </select>

        {/* Level meter */}
        <div class="mic-level-container">
          <div class="mic-level-label">
            <span>Niveau</span>
            <span>{Math.round(micLevel())}%</span>
          </div>
          <div class="mic-level-bar">
            <div
              class={`mic-level-fill ${getLevelClass()}`}
              style={{ width: `${micLevel()}%` }}
            />
          </div>
        </div>

        {/* Waveform */}
        <div class="mic-waveform">
          {waveform().map((h) => (
            <div class="waveform-bar" style={{ height: `${h}px` }} />
          ))}
        </div>

        {/* Actions */}
        <div class="mic-test-actions">
          <Show
            when={!isTesting()}
            fallback={
              <button class="btn btn-primary btn-large" onClick={stopTest}>
                Stop Test
              </button>
            }
          >
            <button class="btn btn-primary btn-large" onClick={startTest}>
              Start Microfoon Test
            </button>
          </Show>
        </div>

        {/* Status */}
        <Show when={status()}>
          {(s) => (
            <div class={`mic-status ${s().type}`}>
              <Show when={s().type === "success"}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </Show>
              <Show when={s().type === "error"}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </Show>
              <Show when={s().type === "info"}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </Show>
              <span>{s().text}</span>
            </div>
          )}
        </Show>
      </div>

      {/* Test result */}
      <Show when={testResult()}>
        {(result) => (
          <div class="mic-test-card">
            <h3>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Resultaat
            </h3>
            <div class="mic-test-result">
              <h4>Getranscribeerde tekst:</h4>
              <p>{result().text || "(geen tekst gedetecteerd)"}</p>
            </div>
            <div class="transcription-meta" style={{ "margin-top": "12px" }}>
              <span class="meta-tag">Taal: {result().language || "auto"}</span>
              <span class="meta-tag">Duur: {result().duration_ms}ms</span>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
