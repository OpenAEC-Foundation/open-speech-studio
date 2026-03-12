import { createSignal, onCleanup, onMount, Show, For } from "solid-js";
import { api, type TranscriptionResult, type ModelInfo, getMicAnalyser, isServerMode } from "../lib/api";

const LANGUAGES = [
  { value: "auto", label: "Auto" },
  { value: "nl", label: "Nederlands" },
  { value: "en", label: "Engels" },
  { value: "de", label: "Duits" },
  { value: "fr", label: "Frans" },
  { value: "es", label: "Spaans" },
  { value: "it", label: "Italiaans" },
  { value: "pt", label: "Portugees" },
  { value: "pl", label: "Pools" },
  { value: "ja", label: "Japans" },
  { value: "zh", label: "Chinees" },
];

export default function MeetingRecorder() {
  const [isRecording, setIsRecording] = createSignal(false);
  const [segments, setSegments] = createSignal<TranscriptionResult[]>([]);
  const [status, setStatus] = createSignal("Klaar om op te nemen");
  const [activeModel, setActiveModel] = createSignal("");
  const [activeLang, setActiveLang] = createSignal("auto");
  const [models, setModels] = createSignal<ModelInfo[]>([]);
  const [useServer, setUseServer] = createSignal(false);
  const [startTime, setStartTime] = createSignal<Date | null>(null);
  const [elapsed, setElapsed] = createSignal("00:00:00");

  // Mic stats
  const [micLevel, setMicLevel] = createSignal(0);
  const [micPeak, setMicPeak] = createSignal(0);
  const [micAvg, setMicAvg] = createSignal(0);
  const [micWaveform, setMicWaveform] = createSignal<number[]>(new Array(32).fill(2));
  const [micClipping, setMicClipping] = createSignal(false);

  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let animFrame: number | null = null;
  let avgSamples: number[] = [];

  onMount(async () => {
    try {
      const s = await api.getSettings();
      setActiveModel(s.model_name || "");
      setActiveLang(s.language || "auto");
    } catch (_) {}
    try {
      const m = await api.getAvailableModels();
      setModels(m.filter((mod) => mod.downloaded));
    } catch (_) {}
    setUseServer(isServerMode());
  });

  onCleanup(() => {
    if (timerInterval) clearInterval(timerInterval);
    if (animFrame) cancelAnimationFrame(animFrame);
  });

  const updateElapsed = () => {
    const start = startTime();
    if (!start) return;
    const diff = Date.now() - start.getTime();
    const h = Math.floor(diff / 3600000).toString().padStart(2, "0");
    const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, "0");
    const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, "0");
    setElapsed(`${h}:${m}:${s}`);
  };

  const startMicMonitor = () => {
    avgSamples = [];
    setMicPeak(0);

    const animate = () => {
      if (!isRecording()) return;

      const analyser = getMicAnalyser();
      if (analyser) {
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);

        // RMS level
        let sum = 0;
        let max = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
          if (dataArray[i] > max) max = dataArray[i];
        }
        const avg = sum / dataArray.length;
        const level = Math.min(100, (avg / 128) * 100);
        const peak = Math.min(100, (max / 255) * 100);

        setMicLevel(level);
        setMicClipping(peak > 95);

        // Track peak
        if (peak > micPeak()) setMicPeak(peak);

        // Running average
        avgSamples.push(level);
        if (avgSamples.length > 300) avgSamples.shift(); // ~5 sec window at 60fps
        const runningAvg = avgSamples.reduce((a, b) => a + b, 0) / avgSamples.length;
        setMicAvg(runningAvg);

        // Waveform bars from frequency data
        const bars = 32;
        const step = Math.floor(dataArray.length / bars);
        const wf: number[] = [];
        for (let i = 0; i < bars; i++) {
          const val = dataArray[i * step] || 0;
          wf.push(2 + (val / 255) * 40);
        }
        setMicWaveform(wf);
      }

      animFrame = requestAnimationFrame(animate);
    };
    animFrame = requestAnimationFrame(animate);
  };

  const stopMicMonitor = () => {
    if (animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
    setMicLevel(0);
    setMicWaveform(new Array(32).fill(2));
  };

  const startRecording = async () => {
    try {
      await api.startRecording();
      setIsRecording(true);
      setStartTime(new Date());
      setStatus("Opnemen... Spreek duidelijk.");
      timerInterval = setInterval(updateElapsed, 1000);
      startMicMonitor();
    } catch (e) {
      setStatus(`Fout: ${e}`);
    }
  };

  const captureSegment = async () => {
    if (!isRecording()) return;
    stopMicMonitor();

    try {
      const result = await api.stopRecording();
      if (result.text && result.text.trim().length > 0) {
        setSegments((prev) => [...prev, result]);
      }
      await api.startRecording();
      startMicMonitor();
      setStatus(`${segments().length + 1} segmenten opgenomen`);
    } catch (e) {
      setStatus(`Fout bij segment: ${e}`);
    }
  };

  const stopRecording = async () => {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    stopMicMonitor();

    try {
      const result = await api.stopRecording();
      setIsRecording(false);
      if (result.text && result.text.trim().length > 0) {
        setSegments((prev) => [...prev, result]);
      }
      setStatus(`Opname gestopt — ${segments().length + (result.text ? 1 : 0)} segmenten`);
    } catch (e) {
      setIsRecording(false);
      setStatus(`Fout: ${e}`);
    }
  };

  const getFullTranscript = () => segments().map((s) => s.text).join("\n\n");

  const copyTranscript = () => {
    navigator.clipboard.writeText(getFullTranscript());
    setStatus("Transcript gekopieerd naar klembord");
  };

  const clearSegments = () => {
    setSegments([]);
    setElapsed("00:00:00");
    setStartTime(null);
    setMicPeak(0);
    setMicAvg(0);
    avgSamples = [];
    setStatus("Klaar om op te nemen");
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const timestamp = () => new Date().toISOString().slice(0, 16).replace(":", "-");

  const exportTxt = () => {
    const blob = new Blob([getFullTranscript()], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, `transcript-${timestamp()}.txt`);
    setStatus("Transcript geexporteerd als .txt");
  };

  const exportMarkdown = () => {
    const lines = [`# Transcript — ${new Date().toLocaleString("nl-NL")}`, ""];
    segments().forEach((s, i) => {
      lines.push(`## Segment ${i + 1}`);
      lines.push("");
      lines.push(`> **Taal:** ${s.language || "auto"} | **Duur:** ${s.duration_ms}ms`);
      lines.push("");
      lines.push(s.text);
      lines.push("");
    });
    lines.push("---");
    lines.push(`*${segments().length} segmenten — ${totalWords()} woorden — opnametijd ${elapsed()}*`);
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    downloadBlob(blob, `transcript-${timestamp()}.md`);
    setStatus("Transcript geexporteerd als .md");
  };

  const exportOdt = async () => {
    const segs = segments();
    const paragraphs = segs.map((s, i) =>
      `<text:h text:style-name="Heading_20_2" text:outline-level="2">Segment ${i + 1}</text:h>
<text:p text:style-name="Text_20_body">${escapeXml(s.text)}</text:p>
<text:p text:style-name="Text_20_body"><text:span text:style-name="meta">Taal: ${s.language || "auto"} | Duur: ${s.duration_ms}ms</text:span></text:p>`
    ).join("\n");

    const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  office:version="1.3">
  <office:automatic-styles>
    <style:style style:name="meta" style:family="text">
      <style:text-properties fo:font-size="9pt" fo:color="#666666" fo:font-style="italic"/>
    </style:style>
  </office:automatic-styles>
  <office:body>
    <office:text>
      <text:h text:style-name="Heading_20_1" text:outline-level="1">Transcript — ${escapeXml(new Date().toLocaleString("nl-NL"))}</text:h>
${paragraphs}
      <text:p text:style-name="Text_20_body">${segs.length} segmenten — ${totalWords()} woorden — opnametijd ${elapsed()}</text:p>
    </office:text>
  </office:body>
</office:document-content>`;

    const metaXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"
  office:version="1.3">
  <office:meta>
    <meta:generator>Open Dictate Studio</meta:generator>
  </office:meta>
</office:document-meta>`;

    const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

    // Build ODT ZIP using the browser Compression Streams API fallback:
    // ODT = ZIP with mimetype (uncompressed) + content.xml + meta.xml + META-INF/manifest.xml
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    // mimetype must be first and uncompressed
    zip.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });
    zip.file("content.xml", contentXml);
    zip.file("meta.xml", metaXml);
    zip.file("META-INF/manifest.xml", manifestXml);

    const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.oasis.opendocument.text" });
    downloadBlob(blob, `transcript-${timestamp()}.odt`);
    setStatus("Transcript geexporteerd als .odt");
  };

  const escapeXml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const getLevelClass = () => {
    const l = micLevel();
    if (l < 10) return "low";
    if (l < 70) return "good";
    return "hot";
  };

  const totalWords = () => {
    return segments().reduce((count, s) => {
      return count + (s.text ? s.text.split(/\s+/).filter(Boolean).length : 0);
    }, 0);
  };

  const totalDuration = () => {
    return segments().reduce((ms, s) => ms + s.duration_ms, 0);
  };

  const changeModel = async (name: string) => {
    const model = models().find((m) => m.name === name);
    if (model?.path) {
      try {
        await api.loadModel(model.path);
        setActiveModel(name);
        const s = await api.getSettings();
        await api.saveSettings({ ...s, model_name: name, model_path: model.path });
        setStatus(`Model gewisseld naar ${name}`);
      } catch (e) {
        setStatus(`Model wisselen mislukt: ${e}`);
      }
    }
  };

  const changeLang = async (lang: string) => {
    setActiveLang(lang);
    try {
      const s = await api.getSettings();
      await api.saveSettings({ ...s, language: lang });
    } catch (_) {}
  };

  return (
    <div class="meeting-recorder">
      <h2>Opnemen & Transcriberen</h2>
      <p class="section-description">
        Neem een vergadering of gesprek op. De audio wordt continu getranscribeerd
        in segmenten. Alle verwerking gebeurt lokaal op je computer.
      </p>

      {/* Model & language selection */}
      <div class="meeting-config">
        <div class="meeting-config-item">
          <label>Model</label>
          <select
            value={activeModel()}
            onChange={(e) => changeModel(e.currentTarget.value)}
            disabled={isRecording()}
          >
            <For each={models()}>
              {(m) => <option value={m.name}>{m.name} ({m.size})</option>}
            </For>
          </select>
        </div>
        <div class="meeting-config-item">
          <label>Taal</label>
          <select
            value={activeLang()}
            onChange={(e) => changeLang(e.currentTarget.value)}
            disabled={isRecording()}
          >
            <For each={LANGUAGES}>
              {(l) => <option value={l.value}>{l.label}</option>}
            </For>
          </select>
        </div>
        <div class="meeting-config-item">
          <label>Backend</label>
          <span class={`meeting-backend-badge ${useServer() ? "local" : "browser"}`}>
            {useServer() ? "Lokaal (Whisper)" : "Browser fallback"}
          </span>
        </div>
      </div>

      <div class="meeting-layout">
        {/* Left: controls + transcript */}
        <div class="meeting-main">
          {/* Recording controls */}
          <div class="meeting-controls">
            <div class="meeting-controls-left">
              <Show
                when={!isRecording()}
                fallback={
                  <>
                    <button class="btn btn-danger" onClick={stopRecording}>
                      Stop Opname
                    </button>
                    <button class="btn btn-primary" onClick={captureSegment}>
                      Segment Opslaan
                    </button>
                  </>
                }
              >
                <button class="btn btn-primary" onClick={startRecording}>
                  Start Opname
                </button>
              </Show>

              <Show when={segments().length > 0 && !isRecording()}>
                <button class="btn" onClick={copyTranscript}>Kopieer Alles</button>
                <button class="btn" onClick={exportTxt}>Exporteer .txt</button>
                <button class="btn" onClick={exportMarkdown}>Exporteer .md</button>
                <button class="btn" onClick={exportOdt}>Exporteer .odt</button>
                <button class="btn btn-danger btn-small" onClick={clearSegments}>Wissen</button>
              </Show>
            </div>

            <div class="meeting-timer">
              <Show when={activeModel()}>
                <span class="meta-tag">{activeModel()}</span>
              </Show>
              <Show when={isRecording()}>
                <span class="meeting-rec-dot" />
              </Show>
              <span class="meeting-elapsed">{elapsed()}</span>
            </div>
          </div>

          <div class="meeting-status">{status()}</div>

          {/* Transcript segments */}
          <div class="meeting-transcript">
            <Show
              when={segments().length > 0}
              fallback={
                <div class="meeting-empty">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style={{ opacity: 0.3 }}>
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                  </svg>
                  <p>Start een opname om het transcript hier te zien.</p>
                  <p class="meeting-tip">
                    Tip: Klik "Segment Opslaan" tijdens de opname om tussendoor te transcriberen
                    zonder de opname te stoppen.
                  </p>
                </div>
              }
            >
              <For each={segments()}>
                {(segment, index) => (
                  <div class="meeting-segment">
                    <div class="meeting-segment-header">
                      <span class="meeting-segment-num">#{index() + 1}</span>
                      <span class="meta-tag">{segment.language || "auto"}</span>
                      <span class="meta-tag">{segment.duration_ms}ms</span>
                    </div>
                    <div class="meeting-segment-text">{segment.text}</div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        {/* Right: mic stats panel */}
        <div class="mic-stats-panel">
          <div class="mic-stats-title">Microfoon</div>

          {/* Waveform */}
          <div class="mic-stats-waveform">
            {micWaveform().map((h) => (
              <div class="mic-stats-bar" style={{ height: `${h}px` }} />
            ))}
          </div>

          {/* Level meter */}
          <div class="mic-stats-meter">
            <div class="mic-stats-meter-label">
              <span>Niveau</span>
              <span>{Math.round(micLevel())}%</span>
            </div>
            <div class="mic-stats-meter-track">
              <div class={`mic-stats-meter-fill ${getLevelClass()}`} style={{ width: `${micLevel()}%` }} />
            </div>
          </div>

          {/* Stats grid */}
          <div class="mic-stats-grid">
            <div class="mic-stat">
              <div class="mic-stat-value">{Math.round(micPeak())}%</div>
              <div class="mic-stat-label">Piek</div>
            </div>
            <div class="mic-stat">
              <div class="mic-stat-value">{Math.round(micAvg())}%</div>
              <div class="mic-stat-label">Gemiddeld</div>
            </div>
            <div class="mic-stat">
              <div class={`mic-stat-value ${micClipping() ? "mic-stat-warning" : ""}`}>
                {micClipping() ? "Ja" : "Nee"}
              </div>
              <div class="mic-stat-label">Clipping</div>
            </div>
            <div class="mic-stat">
              <div class="mic-stat-value">
                {isRecording() ? "Actief" : "Uit"}
              </div>
              <div class="mic-stat-label">Status</div>
            </div>
          </div>

          {/* Session stats */}
          <Show when={segments().length > 0 || isRecording()}>
            <div class="mic-stats-divider" />
            <div class="mic-stats-title">Sessie</div>
            <div class="mic-stats-grid">
              <div class="mic-stat">
                <div class="mic-stat-value">{segments().length}</div>
                <div class="mic-stat-label">Segmenten</div>
              </div>
              <div class="mic-stat">
                <div class="mic-stat-value">{totalWords()}</div>
                <div class="mic-stat-label">Woorden</div>
              </div>
              <div class="mic-stat">
                <div class="mic-stat-value">{(totalDuration() / 1000).toFixed(1)}s</div>
                <div class="mic-stat-label">Verwerkingstijd</div>
              </div>
              <div class="mic-stat">
                <div class="mic-stat-value">{elapsed()}</div>
                <div class="mic-stat-label">Opnametijd</div>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
