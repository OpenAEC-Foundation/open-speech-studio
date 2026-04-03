import { createSignal, createEffect, onCleanup, onMount, Show, For } from "solid-js";
import { api, type TranscriptionResult, type ModelInfo, getMicAnalyser, isServerMode } from "../lib/api";
import { useI18n, getLanguageOptions } from "../lib/i18n";
import { soundRecordStart, soundRecordStop, soundTranscriptionDone, soundError } from "../lib/sounds";

const isTauri = !!(window as any).__TAURI_INTERNALS__;

interface MeetingSegment extends TranscriptionResult {
  timestamp: string;
}

interface MeetingRecorderProps {
  activeModelName?: string;
  audioFeedback?: boolean;
  onRecordingStart?: () => void;
  onRecordingStop?: () => void;
}

export default function MeetingRecorder(props: MeetingRecorderProps) {
  const { t, locale } = useI18n();
  const [isRecording, setIsRecording] = createSignal(false);
  const [segments, setSegments] = createSignal<MeetingSegment[]>([]);
  const [status, setStatus] = createSignal(t("meeting.statusReady"));
  const [activeModel, setActiveModel] = createSignal("");
  const [activeLang, setActiveLang] = createSignal("auto");
  const [models, setModels] = createSignal<ModelInfo[]>([]);
  const [useServer, setUseServer] = createSignal(false);
  const [startTime, setStartTime] = createSignal<Date | null>(null);
  const [elapsed, setElapsed] = createSignal("00:00:00");

  // Auto-transcribe interval (minutes)
  const [autoInterval, setAutoInterval] = createSignal(5);
  let autoTranscribeTimer: ReturnType<typeof setInterval> | null = null;

  // Mic stats
  const [micLevel, setMicLevel] = createSignal(0);
  const [micPeak, setMicPeak] = createSignal(0);
  const [micAvg, setMicAvg] = createSignal(0);
  const [micWaveform, setMicWaveform] = createSignal<number[]>(new Array(32).fill(2));
  const [micClipping, setMicClipping] = createSignal(false);

  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let animFrame: number | null = null;
  let avgSamples: number[] = [];

  // Keep model in sync with the global model selection (from Models page)
  createEffect(() => {
    const fromProps = props.activeModelName;
    if (fromProps && fromProps !== activeModel()) {
      setActiveModel(fromProps);
    }
  });

  onMount(async () => {
    try {
      const s = await api.getSettings();
      if (!props.activeModelName) setActiveModel(s.model_name || "");
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
    if (autoTranscribeTimer) clearInterval(autoTranscribeTimer);
    closeMeetingOverlay();
    if (isRecording()) props.onRecordingStop?.();
  });

  // ─── Overlay for meeting recording ──────────────
  async function showMeetingOverlay() {
    if (!isTauri) return;
    try {
      const { emit } = await import("@tauri-apps/api/event");
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const { currentMonitor } = await import("@tauri-apps/api/window");

      // Reuse existing overlay or create a new one
      const existing = await WebviewWindow.getByLabel("dictation-overlay");
      if (!existing) {
        const monitor = await currentMonitor();
        const screenW = monitor?.size?.width ?? 1920;
        const screenH = monitor?.size?.height ?? 1080;
        const scale = monitor?.scaleFactor ?? 1;
        const overlayW = 280;
        const overlayH = 64;
        const margin = 16;

        new WebviewWindow("dictation-overlay", {
          url: "/?overlay=true",
          title: "Meeting",
          width: overlayW,
          height: overlayH,
          x: Math.round(screenW / scale) - overlayW - margin,
          y: Math.round(screenH / scale) - overlayH - margin - 48,
          decorations: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          resizable: false,
          transparent: true,
          focus: false,
        });
        await new Promise((r) => setTimeout(r, 300));
      }
      await emit("overlay-state", "recording");
    } catch (e) {
      console.error("Meeting overlay error:", e);
    }
  }

  async function closeMeetingOverlay() {
    if (!isTauri) return;
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("overlay-close");
    } catch (_) {}
  }

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
      if (props.audioFeedback !== false) soundRecordStart();
      await api.startRecording();
      setIsRecording(true);
      setStartTime(new Date());
      setStatus(t("meeting.statusRecording"));
      timerInterval = setInterval(updateElapsed, 1000);
      startMicMonitor();
      showMeetingOverlay();
      props.onRecordingStart?.();

      // Start auto-transcribe interval
      const intervalMs = autoInterval() * 60 * 1000;
      autoTranscribeTimer = setInterval(() => {
        if (isRecording()) {
          captureSegment();
        }
      }, intervalMs);
    } catch (e) {
      if (props.audioFeedback !== false) soundError();
      setStatus(t("meeting.statusError", { error: String(e) }));
    }
  };

  const captureSegment = async () => {
    if (!isRecording()) return;
    stopMicMonitor();
    if (props.audioFeedback !== false) soundRecordStop();

    try {
      const result = await api.stopRecording();
      if (result.text && result.text.trim().length > 0) {
        setSegments((prev) => [...prev, { ...result, timestamp: formatTime(new Date()) }]);
        if (props.audioFeedback !== false) soundTranscriptionDone();
      }
      if (props.audioFeedback !== false) soundRecordStart();
      await api.startRecording();
      startMicMonitor();
      setStatus(t("meeting.statusSegments", { count: segments().length + 1 }));
    } catch (e) {
      if (props.audioFeedback !== false) soundError();
      setStatus(t("meeting.statusSegmentError", { error: String(e) }));
    }
  };

  const stopRecording = async () => {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (autoTranscribeTimer) {
      clearInterval(autoTranscribeTimer);
      autoTranscribeTimer = null;
    }
    stopMicMonitor();
    closeMeetingOverlay();
    props.onRecordingStop?.();

    try {
      if (props.audioFeedback !== false) soundRecordStop();
      const result = await api.stopRecording();
      setIsRecording(false);
      if (result.text && result.text.trim().length > 0) {
        setSegments((prev) => [...prev, { ...result, timestamp: formatTime(new Date()) }]);
        if (props.audioFeedback !== false) soundTranscriptionDone();
      }
      setStatus(t("meeting.statusStopped", { count: segments().length + (result.text ? 1 : 0) }));
    } catch (e) {
      setIsRecording(false);
      if (props.audioFeedback !== false) soundError();
      setStatus(t("meeting.statusError", { error: String(e) }));
    }
  };

  const formatTime = (date: Date) => date.toLocaleTimeString(locale() === "nl" ? "nl-NL" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const getFullTranscript = () => segments().map((s) => `[${s.timestamp}] ${s.text}`).join("\n\n");

  const copyTranscript = () => {
    navigator.clipboard.writeText(getFullTranscript());
    setStatus(t("meeting.statusCopied"));
  };

  const clearSegments = () => {
    setSegments([]);
    setElapsed("00:00:00");
    setStartTime(null);
    setMicPeak(0);
    setMicAvg(0);
    avgSamples = [];
    setStatus(t("meeting.statusReady"));
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
    setStatus(t("meeting.statusExportedTxt"));
  };

  const exportMarkdown = () => {
    const lines = [`# Transcript — ${new Date().toLocaleString(locale() === "nl" ? "nl-NL" : "en-US")}`, ""];
    segments().forEach((s, i) => {
      lines.push(`## ${t("meeting.exportSegment")} ${i + 1} — ${s.timestamp}`);
      lines.push("");
      lines.push(`> **${s.timestamp}** | **${t("meeting.exportLanguage")}** ${s.language || "auto"} | **${t("meeting.exportDuration")}** ${s.duration_ms}ms`);
      lines.push("");
      lines.push(s.text);
      lines.push("");
    });
    lines.push("---");
    lines.push(`*${t("meeting.exportSegmentsCount", { count: segments().length })} — ${t("meeting.exportWordsCount", { count: totalWords() })} — ${t("meeting.exportRecordingTime", { time: elapsed() })}*`);
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    downloadBlob(blob, `transcript-${timestamp()}.md`);
    setStatus(t("meeting.statusExportedMd"));
  };

  const exportOdt = async () => {
    const segs = segments();
    const paragraphs = segs.map((s, i) =>
      `<text:h text:style-name="Heading_20_2" text:outline-level="2">${escapeXml(t("meeting.exportSegment"))} ${i + 1} — ${escapeXml(s.timestamp)}</text:h>
<text:p text:style-name="Text_20_body">${escapeXml(s.text)}</text:p>
<text:p text:style-name="Text_20_body"><text:span text:style-name="meta">${escapeXml(s.timestamp)} | ${escapeXml(t("meeting.exportLanguage"))} ${s.language || "auto"} | ${escapeXml(t("meeting.exportDuration"))} ${s.duration_ms}ms</text:span></text:p>`
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
      <text:h text:style-name="Heading_20_1" text:outline-level="1">Transcript — ${escapeXml(new Date().toLocaleString(locale() === "nl" ? "nl-NL" : "en-US"))}</text:h>
${paragraphs}
      <text:p text:style-name="Text_20_body">${escapeXml(t("meeting.exportSegmentsCount", { count: segs.length }))} — ${escapeXml(t("meeting.exportWordsCount", { count: totalWords() }))} — ${escapeXml(t("meeting.exportRecordingTime", { time: elapsed() }))}</text:p>
    </office:text>
  </office:body>
</office:document-content>`;

    const metaXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"
  office:version="1.3">
  <office:meta>
    <meta:generator>Open Speech Studio</meta:generator>
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
    setStatus(t("meeting.statusExportedOdt"));
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
        setStatus(t("meeting.statusModelChanged", { name }));
      } catch (e) {
        setStatus(t("meeting.statusModelChangeFailed", { error: String(e) }));
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
      <h2>{t("meeting.title")}</h2>
      <p class="section-description">
        {t("meeting.description")}
      </p>

      {/* Model & language selection */}
      <div class="meeting-config">
        <div class="meeting-config-item">
          <label>{t("meeting.model")}</label>
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
          <label>{t("meeting.language")}</label>
          <select
            value={activeLang()}
            onChange={(e) => changeLang(e.currentTarget.value)}
            disabled={isRecording()}
          >
            <For each={getLanguageOptions(t)}>
              {(l) => <option value={l.value}>{l.label}</option>}
            </For>
          </select>
        </div>
        <div class="meeting-config-item">
          <label>{t("meeting.autoInterval")}</label>
          <select
            value={autoInterval()}
            onChange={(e) => setAutoInterval(parseInt(e.currentTarget.value, 10))}
            disabled={isRecording()}
          >
            <option value="1">1 min</option>
            <option value="2">2 min</option>
            <option value="3">3 min</option>
            <option value="5">5 min</option>
            <option value="10">10 min</option>
            <option value="15">15 min</option>
            <option value="30">30 min</option>
          </select>
        </div>
        <div class="meeting-config-item">
          <label>{t("meeting.backend")}</label>
          <span class={`meeting-backend-badge ${useServer() ? "local" : "browser"}`}>
            {useServer() ? t("meeting.backendLocal") : t("meeting.backendBrowser")}
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
                      {t("meeting.stopRecording")}
                    </button>
                    <button class="btn btn-primary" onClick={captureSegment}>
                      {t("meeting.saveSegment")}
                    </button>
                  </>
                }
              >
                <button class="btn btn-primary" onClick={startRecording}>
                  {t("meeting.startRecording")}
                </button>
              </Show>

              <Show when={segments().length > 0 && !isRecording()}>
                <button class="btn" onClick={copyTranscript}>{t("meeting.copyAll")}</button>
                <button class="btn" onClick={exportTxt}>{t("meeting.exportTxt")}</button>
                <button class="btn" onClick={exportMarkdown}>{t("meeting.exportMd")}</button>
                <button class="btn" onClick={exportOdt}>{t("meeting.exportOdt")}</button>
                <button class="btn btn-danger btn-small" onClick={clearSegments}>{t("meeting.clear")}</button>
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
                  <p>{t("meeting.emptyTranscript")}</p>
                  <p class="meeting-tip">
                    {t("meeting.tip")}
                  </p>
                </div>
              }
            >
              <For each={segments()}>
                {(segment, index) => (
                  <div class="meeting-segment">
                    <div class="meeting-segment-header">
                      <span class="meeting-segment-num">#{index() + 1}</span>
                      <span class="meta-tag">{segment.timestamp}</span>
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
          <div class="mic-stats-title">{t("meeting.mic")}</div>

          {/* Waveform */}
          <div class="mic-stats-waveform">
            {micWaveform().map((h) => (
              <div class="mic-stats-bar" style={{ height: `${h}px` }} />
            ))}
          </div>

          {/* Level meter */}
          <div class="mic-stats-meter">
            <div class="mic-stats-meter-label">
              <span>{t("meeting.micLevel")}</span>
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
              <div class="mic-stat-label">{t("meeting.micPeak")}</div>
            </div>
            <div class="mic-stat">
              <div class="mic-stat-value">{Math.round(micAvg())}%</div>
              <div class="mic-stat-label">{t("meeting.micAvg")}</div>
            </div>
            <div class="mic-stat">
              <div class={`mic-stat-value ${micClipping() ? "mic-stat-warning" : ""}`}>
                {micClipping() ? t("common.yes") : t("common.no")}
              </div>
              <div class="mic-stat-label">{t("meeting.micClipping")}</div>
            </div>
            <div class="mic-stat">
              <div class="mic-stat-value">
                {isRecording() ? t("meeting.micActive") : t("meeting.micOff")}
              </div>
              <div class="mic-stat-label">{t("meeting.micStatus")}</div>
            </div>
          </div>

          {/* Session stats */}
          <Show when={segments().length > 0 || isRecording()}>
            <div class="mic-stats-divider" />
            <div class="mic-stats-title">{t("meeting.session")}</div>
            <div class="mic-stats-grid">
              <div class="mic-stat">
                <div class="mic-stat-value">{segments().length}</div>
                <div class="mic-stat-label">{t("meeting.sessionSegments")}</div>
              </div>
              <div class="mic-stat">
                <div class="mic-stat-value">{totalWords()}</div>
                <div class="mic-stat-label">{t("meeting.sessionWords")}</div>
              </div>
              <div class="mic-stat">
                <div class="mic-stat-value">{(totalDuration() / 1000).toFixed(1)}s</div>
                <div class="mic-stat-label">{t("meeting.sessionProcessingTime")}</div>
              </div>
              <div class="mic-stat">
                <div class="mic-stat-value">{elapsed()}</div>
                <div class="mic-stat-label">{t("meeting.sessionRecordingTime")}</div>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
