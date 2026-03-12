#!/usr/bin/env node
/**
 * Open Speech Studio - Unified Installer
 * OpenAEC Foundation
 *
 * One script to install everything on Windows and Linux.
 * No C++ toolchain needed - uses pre-compiled whisper.cpp binary.
 *
 * Usage: node setup.js [--dev]
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { createUnzip } = require("zlib");

const ROOT = __dirname;
const MODELS_DIR = path.join(ROOT, "models");
const BIN_DIR = path.join(ROOT, "bin");

const ARGS = process.argv.slice(2);
const DEV_ONLY = ARGS.includes("--dev");
const IS_WIN = process.platform === "win32";
const ARCH = process.arch; // x64, arm64

// whisper.cpp release version and URLs (from ggml-org/whisper.cpp)
const WHISPER_VERSION = "v1.8.3";
const WHISPER_RELEASES = {
  "win32-x64": `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`,
};

// ─── Helpers ────────────────────────────────────────────────────

function log(msg) {
  console.log(`\x1b[36m[setup]\x1b[0m ${msg}`);
}
function ok(msg) {
  console.log(`\x1b[32m  [OK]\x1b[0m ${msg}`);
}
function warn(msg) {
  console.log(`\x1b[33m  [!]\x1b[0m ${msg}`);
}
function fail(msg) {
  console.error(`\x1b[31m  [ERROR]\x1b[0m ${msg}`);
}

function run(cmd, opts = {}) {
  try {
    execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
    return true;
  } catch {
    return false;
  }
}

function hasCommand(cmd) {
  try {
    execSync(IS_WIN ? `where ${cmd}` : `which ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function getVersion(cmd) {
  try {
    return execSync(`${cmd} --version`, { stdio: "pipe" }).toString().trim().split("\n")[0];
  } catch {
    return null;
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const basename = path.basename(dest);
    let totalBytes = 0;
    let receivedBytes = 0;

    const doRequest = (requestUrl) => {
      const client = requestUrl.startsWith("https") ? https : http;
      client
        .get(requestUrl, { headers: { "User-Agent": "OpenSpeechStudio/0.1" } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            file.close();
            try { fs.unlinkSync(dest); } catch {}
            doRequest(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            file.close();
            try { fs.unlinkSync(dest); } catch {}
            reject(new Error(`HTTP ${res.statusCode} for ${requestUrl}`));
            return;
          }

          totalBytes = parseInt(res.headers["content-length"] || "0", 10);
          res.pipe(file);

          res.on("data", (chunk) => {
            receivedBytes += chunk.length;
            if (totalBytes > 0) {
              const pct = ((receivedBytes / totalBytes) * 100).toFixed(1);
              const mb = (receivedBytes / 1048576).toFixed(1);
              const totalMb = (totalBytes / 1048576).toFixed(1);
              process.stdout.write(
                `\r  ${basename}: ${mb} / ${totalMb} MB (${pct}%)     `
              );
            }
          });

          file.on("finish", () => {
            file.close();
            process.stdout.write("\n");
            resolve();
          });
        })
        .on("error", (err) => {
          file.close();
          try { fs.unlinkSync(dest); } catch {}
          reject(err);
        });
    };

    doRequest(url);
  });
}

function extractZip(zipPath, destDir) {
  log(`Uitpakken naar ${destDir}...`);
  fs.mkdirSync(destDir, { recursive: true });

  if (IS_WIN) {
    // Use PowerShell to extract on Windows
    run(`powershell.exe -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`);
  } else {
    run(`unzip -o "${zipPath}" -d "${destDir}"`);
  }
}

// ─── Steps ──────────────────────────────────────────────────────

async function checkNodejs() {
  log("Node.js controleren...");
  if (!hasCommand("node")) {
    fail("Node.js is niet geinstalleerd.");
    if (IS_WIN) {
      warn("Installeer Node.js: https://nodejs.org/");
    } else {
      warn("Installeer via: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs");
    }
    process.exit(1);
  }
  ok(getVersion("node"));
}

async function checkRust() {
  log("Rust controleren...");
  if (!hasCommand("rustc")) {
    warn("Rust niet gevonden. Installeren...");
    if (IS_WIN) {
      warn("Download en installeer Rust: https://rustup.rs/");
      warn("Herstart daarna dit script.");
      process.exit(1);
    } else {
      run('curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y');
      process.env.PATH = `${process.env.HOME}/.cargo/bin:${process.env.PATH}`;
    }
  }
  ok(getVersion("rustc"));
}

async function checkSystemDeps() {
  log("Systeem-afhankelijkheden controleren...");

  if (IS_WIN) {
    ok("WebView2 (ingebouwd in Windows 10/11)");
  } else {
    if (hasCommand("apt-get")) {
      run(
        "sudo apt-get update && sudo apt-get install -y build-essential curl wget " +
          "libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev " +
          "librsvg2-dev libasound2-dev pkg-config"
      );
    } else if (hasCommand("dnf")) {
      run(
        "sudo dnf install -y gcc gcc-c++ curl wget webkit2gtk4.1-devel openssl-devel " +
          "gtk3-devel libappindicator-gtk3-devel librsvg2-devel alsa-lib-devel"
      );
    } else if (hasCommand("pacman")) {
      run(
        "sudo pacman -S --needed --noconfirm base-devel curl wget webkit2gtk-4.1 openssl " +
          "gtk3 libappindicator-gtk3 librsvg alsa-lib"
      );
    }
    ok("Systeem-afhankelijkheden geinstalleerd");
  }
}

async function installNpmDeps() {
  log("NPM dependencies installeren...");
  if (!run("npm install")) {
    fail("npm install mislukt");
    process.exit(1);
  }
  ok("NPM dependencies geinstalleerd");
}

async function downloadWhisperBinary() {
  log("Whisper.cpp binary controleren...");
  fs.mkdirSync(BIN_DIR, { recursive: true });

  const binName = IS_WIN ? "whisper-cli.exe" : "whisper-cli";
  const altName = IS_WIN ? "main.exe" : "main";
  const binPath = path.join(BIN_DIR, binName);
  const altPath = path.join(BIN_DIR, altName);

  if (fs.existsSync(binPath) || fs.existsSync(altPath)) {
    ok("Whisper binary al aanwezig");
    return;
  }

  const platform = `${process.platform}-${ARCH}`;
  const url = WHISPER_RELEASES[platform];

  if (!url) {
    fail(`Geen pre-compiled whisper binary beschikbaar voor ${platform}`);
    warn("Handmatig downloaden van: https://github.com/ggerganov/whisper.cpp/releases");
    return;
  }

  const zipDest = path.join(BIN_DIR, "whisper.zip");

  log(`Whisper.cpp ${WHISPER_VERSION} downloaden voor ${platform}...`);
  try {
    await download(url, zipDest);
    extractZip(zipDest, BIN_DIR);
    fs.unlinkSync(zipDest);

    // Find the binary in extracted files (may be in a subdirectory)
    const findBin = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = findBin(fullPath);
          if (found) return found;
        } else if (entry.name === binName || entry.name === altName) {
          return fullPath;
        }
      }
      return null;
    };

    const foundBin = findBin(BIN_DIR);
    if (foundBin && foundBin !== binPath) {
      // Move binary to bin/ root
      fs.copyFileSync(foundBin, binPath);
      if (!IS_WIN) fs.chmodSync(binPath, 0o755);
    }

    ok(`Whisper binary geinstalleerd: ${binPath}`);
  } catch (err) {
    fail(`Download mislukt: ${err.message}`);
    warn("Handmatig downloaden van: https://github.com/ggerganov/whisper.cpp/releases");
  }
}

async function downloadModels() {
  log("Whisper spraakmodellen controleren...");
  fs.mkdirSync(MODELS_DIR, { recursive: true });

  const models = [
    {
      name: "tiny",
      file: "ggml-tiny.bin",
      size: "75 MB",
      url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    },
    {
      name: "base",
      file: "ggml-base.bin",
      size: "142 MB",
      url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    },
    {
      name: "small",
      file: "ggml-small.bin",
      size: "466 MB",
      url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    },
  ];

  for (const model of models) {
    const dest = path.join(MODELS_DIR, model.file);
    if (fs.existsSync(dest)) {
      const stat = fs.statSync(dest);
      if (stat.size > 1000000) {
        ok(`Model "${model.name}" al aanwezig (${(stat.size / 1048576).toFixed(1)} MB)`);
        continue;
      }
    }

    log(`Model "${model.name}" downloaden (${model.size})...`);
    try {
      await download(model.url, dest);
      ok(`Model "${model.name}" gedownload`);
    } catch (err) {
      fail(`Download mislukt voor ${model.name}: ${err.message}`);
    }
  }
}

async function updateSettings() {
  log("Standaard instellingen configureren...");

  const smallPath = path.join(MODELS_DIR, "ggml-small.bin");
  const basePath = path.join(MODELS_DIR, "ggml-base.bin");
  const tinyPath = path.join(MODELS_DIR, "ggml-tiny.bin");
  const defaultModel = fs.existsSync(smallPath) ? smallPath : fs.existsSync(basePath) ? basePath : tinyPath;
  const defaultName = fs.existsSync(smallPath) ? "small" : fs.existsSync(basePath) ? "base" : "tiny";

  const settingsContent = {
    language: "nl",
    model_name: defaultName,
    model_path: defaultModel.replace(/\\/g, "/"),
    use_gpu: false,
    hotkey: "CmdOrCtrl+Shift+Space",
    auto_paste: true,
    audio_device: "default",
    theme: "light",
  };

  const configPath = path.join(ROOT, "config.default.json");
  fs.writeFileSync(configPath, JSON.stringify(settingsContent, null, 2));

  ok(`Standaard model: ${defaultName}`);
}

async function buildApp() {
  if (DEV_ONLY) {
    log("--dev modus: build overgeslagen");
    return;
  }

  log("Applicatie bouwen...");
  if (!run("npx tauri build")) {
    fail("Build mislukt. Gebruik 'node setup.js --dev' om alleen dependencies te installeren.");
    process.exit(1);
  }

  ok("Build voltooid!");

  const bundleDir = path.join(ROOT, "src-tauri", "target", "release", "bundle");
  if (fs.existsSync(bundleDir)) {
    log("Installers te vinden in:");
    const items = fs.readdirSync(bundleDir);
    for (const item of items) {
      const full = path.join(bundleDir, item);
      if (fs.statSync(full).isDirectory()) {
        const files = fs.readdirSync(full);
        for (const f of files) {
          console.log(`  ${path.join(bundleDir, item, f)}`);
        }
      }
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║       Open Speech Studio - Installer         ║");
  console.log("║           OpenAEC Foundation                  ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log("");

  await checkNodejs();
  await checkRust();
  await checkSystemDeps();
  await installNpmDeps();
  await downloadWhisperBinary();
  await downloadModels();
  await updateSettings();
  await buildApp();

  console.log("");
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║            Installatie voltooid!              ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log("");

  if (DEV_ONLY) {
    console.log("  Start development met:");
    console.log("    npx tauri dev");
  } else {
    console.log("  De applicatie is gebouwd en klaar voor gebruik.");
    console.log("  Installers staan in: src-tauri/target/release/bundle/");
  }
  console.log("");
}

main().catch((err) => {
  fail(err.message);
  process.exit(1);
});
