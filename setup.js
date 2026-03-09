#!/usr/bin/env node
/**
 * Open Speech Studio - Unified Installer
 * OpenAEC Foundation
 *
 * One script to install everything on Windows and Linux.
 * Usage: node setup.js [--cuda] [--dev]
 */

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const ROOT = __dirname;
const MODELS_DIR = path.join(ROOT, "models");

const ARGS = process.argv.slice(2);
const WITH_CUDA = ARGS.includes("--cuda");
const DEV_ONLY = ARGS.includes("--dev");
const IS_WIN = process.platform === "win32";

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

/**
 * Download a file with redirect support.
 */
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
          // Handle redirects
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            file.close();
            fs.unlinkSync(dest);
            doRequest(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            file.close();
            fs.unlinkSync(dest);
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
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          reject(err);
        });
    };

    doRequest(url);
  });
}

// ─── Steps ──────────────────────────────────────────────────────

async function checkNodejs() {
  log("Node.js controleren...");
  if (!hasCommand("node")) {
    fail("Node.js is niet geïnstalleerd.");
    if (IS_WIN) {
      warn("Installeer Node.js: https://nodejs.org/");
      warn("Of via winget: winget install OpenJS.NodeJS.LTS");
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
    // Check for Visual Studio Build Tools
    const vsWhere = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
    if (fs.existsSync(vsWhere)) {
      ok("Visual Studio Build Tools gevonden");
    } else {
      warn("Visual Studio Build Tools niet gevonden.");
      warn("Installeer: https://visualstudio.microsoft.com/visual-cpp-build-tools/");
      warn("Selecteer 'Desktop development with C++'");
    }
    // WebView2 is included in Windows 10/11
    ok("WebView2 (ingebouwd in Windows 10/11)");
  } else {
    // Linux: install required packages
    if (hasCommand("apt-get")) {
      log("APT packages installeren...");
      run(
        "sudo apt-get update && sudo apt-get install -y build-essential curl wget " +
          "libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev " +
          "librsvg2-dev libasound2-dev pkg-config cmake"
      );
    } else if (hasCommand("dnf")) {
      log("DNF packages installeren...");
      run(
        "sudo dnf install -y gcc gcc-c++ curl wget webkit2gtk4.1-devel openssl-devel " +
          "gtk3-devel libappindicator-gtk3-devel librsvg2-devel alsa-lib-devel cmake"
      );
    } else if (hasCommand("pacman")) {
      log("Pacman packages installeren...");
      run(
        "sudo pacman -S --needed --noconfirm base-devel curl wget webkit2gtk-4.1 openssl " +
          "gtk3 libappindicator-gtk3 librsvg alsa-lib cmake"
      );
    }
    ok("Systeem-afhankelijkheden geïnstalleerd");
  }
}

async function installNpmDeps() {
  log("NPM dependencies installeren...");
  if (!run("npm install")) {
    fail("npm install mislukt");
    process.exit(1);
  }
  ok("NPM dependencies geïnstalleerd");
}

async function installTauriCli() {
  log("Tauri CLI controleren...");
  if (!hasCommand("cargo-tauri")) {
    log("Tauri CLI installeren (dit kan enkele minuten duren)...");
    run('cargo install tauri-cli --version "^2.0"');
  }
  ok("Tauri CLI beschikbaar");
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

  // Set the default model path to the bundled base model
  const basePath = path.join(MODELS_DIR, "ggml-base.bin");
  const tinyPath = path.join(MODELS_DIR, "ggml-tiny.bin");

  const defaultModel = fs.existsSync(basePath) ? basePath : tinyPath;
  const defaultName = fs.existsSync(basePath) ? "base" : "tiny";

  // Write default settings that point to the bundled model
  const settingsContent = {
    language: "auto",
    model_name: defaultName,
    model_path: defaultModel.replace(/\\/g, "/"),
    use_gpu: false,
    hotkey: "CmdOrCtrl+Shift+Space",
    auto_paste: true,
    audio_device: "default",
    theme: "light",
  };

  // Store as a project-level default config
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
  const features = WITH_CUDA ? " --features cuda" : "";
  if (!run(`cargo tauri build${features}`)) {
    fail("Build mislukt. Gebruik 'node setup.js --dev' om alleen dependencies te installeren.");
    process.exit(1);
  }

  ok("Build voltooid!");

  // Show installer location
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

  if (WITH_CUDA) log("CUDA ondersteuning: AAN");

  await checkNodejs();
  await checkRust();
  await checkSystemDeps();
  await installNpmDeps();
  await downloadModels();
  await updateSettings();
  await installTauriCli();
  await buildApp();

  console.log("");
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║            Installatie voltooid!              ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log("");

  if (DEV_ONLY) {
    console.log("  Start development met:");
    console.log("    cargo tauri dev");
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
