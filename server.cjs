#!/usr/bin/env node
/**
 * Open Speech Studio — Local Transcription Server
 *
 * Wraps whisper-cli.exe so the browser frontend can use local Whisper models
 * instead of Web Speech API (which sends audio to Google/Microsoft).
 *
 * Usage: node server.js [--port 3333] [--model base]
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const os = require("os");

// ─── Config ────────────────────────────────────────────────────

const args = process.argv.slice(2);
const PORT = getArg("--port", 3333);
const DEFAULT_MODEL = getArg("--model", "base");

const BIN_DIR = path.join(__dirname, "bin");
const MODELS_DIR = path.join(__dirname, "models");
const WHISPER_BIN = path.join(BIN_DIR, process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli");
const TEMP_DIR = os.tmpdir();

let currentModel = DEFAULT_MODEL;
let currentModelPath = path.join(MODELS_DIR, `ggml-${DEFAULT_MODEL}.bin`);

function getArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return isNaN(args[idx + 1]) ? args[idx + 1] : Number(args[idx + 1]);
  return defaultVal;
}

// ─── Helpers ───────────────────────────────────────────────────

function getAvailableModels() {
  const sizes = { tiny: "~75 MB", base: "~142 MB", small: "~466 MB", medium: "~1.5 GB", "large-v3-turbo": "~1.6 GB", "large-v3": "~3.1 GB" };
  const allModels = ["tiny", "base", "small", "medium", "large-v3-turbo", "large-v3"];
  return allModels.map((name) => {
    const filePath = path.join(MODELS_DIR, `ggml-${name}.bin`);
    const downloaded = fs.existsSync(filePath);
    return {
      name,
      size: sizes[name] || "?",
      downloaded,
      path: downloaded ? filePath : null,
      active: name === currentModel && downloaded,
    };
  });
}

function writeWav(pcmBuffer, sampleRate, channels) {
  // pcmBuffer is raw 16-bit PCM data
  const wavPath = path.join(TEMP_DIR, `ods_server_${Date.now()}.wav`);
  const dataLen = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28); // byte rate
  header.writeUInt16LE(channels * 2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataLen, 40);

  fs.writeFileSync(wavPath, Buffer.concat([header, pcmBuffer]));
  return wavPath;
}

function transcribe(wavPath, language) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(WHISPER_BIN)) {
      return reject(new Error(`whisper-cli niet gevonden: ${WHISPER_BIN}`));
    }
    if (!fs.existsSync(currentModelPath)) {
      return reject(new Error(`Model niet gevonden: ${currentModelPath}`));
    }

    const args = ["-m", currentModelPath, "-f", wavPath, "--no-timestamps", "-t", "4", "--output-txt"];
    if (language && language !== "auto") {
      args.push("-l", language);
    }

    const startTime = Date.now();

    execFile(WHISPER_BIN, args, { cwd: TEMP_DIR, timeout: 120000 }, (err, stdout, stderr) => {
      const durationMs = Date.now() - startTime;

      // Clean up WAV
      try { fs.unlinkSync(wavPath); } catch (_) {}

      if (err) {
        return reject(new Error(`Whisper fout: ${err.message}\n${stderr}`));
      }

      // Try stdout first, then check for .txt file
      let text = stdout.trim();
      if (!text) {
        const txtPath = wavPath.replace(/\.wav$/, ".txt");
        try {
          text = fs.readFileSync(txtPath, "utf-8").trim();
          fs.unlinkSync(txtPath);
        } catch (_) {}
      }

      resolve({
        text: text || "",
        language: language || "auto",
        duration_ms: durationMs,
        model: currentModel,
      });
    });
  });
}

// ─── HTTP Server ───────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function jsonResponse(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    // ── GET /api/status ──
    if (url.pathname === "/api/status" && req.method === "GET") {
      return jsonResponse(res, 200, {
        status: "ok",
        model: currentModel,
        modelLoaded: fs.existsSync(currentModelPath),
        whisperAvailable: fs.existsSync(WHISPER_BIN),
      });
    }

    // ── GET /api/models ──
    if (url.pathname === "/api/models" && req.method === "GET") {
      return jsonResponse(res, 200, { models: getAvailableModels() });
    }

    // ── POST /api/load-model ──
    if (url.pathname === "/api/load-model" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString());
      const name = body.model || body.name;
      const modelPath = path.join(MODELS_DIR, `ggml-${name}.bin`);

      if (!fs.existsSync(modelPath)) {
        return jsonResponse(res, 404, { error: `Model '${name}' niet gevonden. Download eerst ggml-${name}.bin naar ${MODELS_DIR}` });
      }

      currentModel = name;
      currentModelPath = modelPath;
      return jsonResponse(res, 200, { message: `Model '${name}' geladen`, model: name });
    }

    // ── POST /api/transcribe ──
    if (url.pathname === "/api/transcribe" && req.method === "POST") {
      const rawBody = await readBody(req);
      const contentType = req.headers["content-type"] || "";
      let wavPath;
      let language = url.searchParams.get("lang") || "auto";

      if (contentType.includes("audio/wav") || contentType.includes("audio/wave")) {
        // Raw WAV upload
        wavPath = path.join(TEMP_DIR, `ods_server_${Date.now()}.wav`);
        fs.writeFileSync(wavPath, rawBody);
      } else if (contentType.includes("audio/raw") || contentType.includes("application/octet-stream")) {
        // Raw 16-bit PCM mono 16kHz
        const sampleRate = parseInt(url.searchParams.get("rate") || "16000");
        const channels = parseInt(url.searchParams.get("channels") || "1");
        wavPath = writeWav(rawBody, sampleRate, channels);
      } else if (contentType.includes("multipart/form-data")) {
        // Simple multipart handling for FormData with audio file
        // Parse boundary
        const boundary = contentType.split("boundary=")[1];
        if (!boundary) return jsonResponse(res, 400, { error: "Geen boundary in multipart" });

        const parts = rawBody.toString("binary").split(`--${boundary}`);
        let audioData = null;

        for (const part of parts) {
          if (part.includes("Content-Type: audio/")) {
            const headerEnd = part.indexOf("\r\n\r\n");
            if (headerEnd !== -1) {
              audioData = Buffer.from(part.slice(headerEnd + 4).replace(/\r\n$/, ""), "binary");
            }
          }
          // Check for language field
          if (part.includes('name="language"')) {
            const headerEnd = part.indexOf("\r\n\r\n");
            if (headerEnd !== -1) {
              language = part.slice(headerEnd + 4).trim().replace(/\r\n.*/, "");
            }
          }
        }

        if (!audioData) {
          return jsonResponse(res, 400, { error: "Geen audiobestand gevonden in upload" });
        }

        wavPath = path.join(TEMP_DIR, `ods_server_${Date.now()}.wav`);
        fs.writeFileSync(wavPath, audioData);
      } else {
        return jsonResponse(res, 400, { error: `Ongeldig content-type: ${contentType}. Gebruik audio/wav, audio/raw, of multipart/form-data` });
      }

      const result = await transcribe(wavPath, language);
      return jsonResponse(res, 200, result);
    }

    // ── 404 ──
    jsonResponse(res, 404, { error: "Niet gevonden" });
  } catch (err) {
    console.error("Server error:", err);
    jsonResponse(res, 500, { error: err.message });
  }
});

// ─── Start ─────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║  Open Speech Studio — Transcription Server            ║
╠══════════════════════════════════════════════════════╣
║  Server:  http://localhost:${PORT}                      ║
║  Model:   ${currentModel.padEnd(42)}║
║  Whisper: ${fs.existsSync(WHISPER_BIN) ? "gevonden".padEnd(42) : "NIET GEVONDEN!".padEnd(42)}║
╚══════════════════════════════════════════════════════╝

Endpoints:
  GET  /api/status       — Server status + actief model
  GET  /api/models       — Beschikbare modellen
  POST /api/load-model   — Model wisselen {"model":"tiny"}
  POST /api/transcribe   — Audio uploaden → transcriptie

Druk Ctrl+C om te stoppen.
`);
});
