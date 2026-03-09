# Open Speech Studio - Windows Installer Script
# Installs all dependencies and builds the application

param(
    [switch]$WithCuda,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Open Speech Studio - Windows Setup" -ForegroundColor Cyan
Write-Host "  OpenAEC Foundation" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check for required tools
function Check-Command($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

# 1. Check Node.js
if (-not (Check-Command "node")) {
    Write-Host "[!] Node.js niet gevonden. Installeren via winget..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}
Write-Host "[OK] Node.js $(node --version)" -ForegroundColor Green

# 2. Check Rust
if (-not (Check-Command "rustc")) {
    Write-Host "[!] Rust niet gevonden. Installeren..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile "$env:TEMP\rustup-init.exe"
    & "$env:TEMP\rustup-init.exe" -y --default-toolchain stable
    $env:Path += ";$env:USERPROFILE\.cargo\bin"
}
Write-Host "[OK] Rust $(rustc --version)" -ForegroundColor Green

# 3. Check for Visual Studio Build Tools (required for Tauri on Windows)
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vsWhere) {
    $vsPath = & $vsWhere -latest -property installationPath
    if ($vsPath) {
        Write-Host "[OK] Visual Studio Build Tools gevonden" -ForegroundColor Green
    }
} else {
    Write-Host "[!] Visual Studio Build Tools niet gevonden." -ForegroundColor Yellow
    Write-Host "    Installeer via: https://visualstudio.microsoft.com/visual-cpp-build-tools/" -ForegroundColor Yellow
    Write-Host "    Selecteer 'Desktop development with C++'" -ForegroundColor Yellow
}

# 4. Install npm dependencies
Write-Host ""
Write-Host "NPM dependencies installeren..." -ForegroundColor Cyan
npm install

# 5. Install Tauri CLI
Write-Host "Tauri CLI installeren..." -ForegroundColor Cyan
cargo install tauri-cli --version "^2.0"

# 6. Build
if (-not $SkipBuild) {
    Write-Host ""
    Write-Host "Applicatie bouwen..." -ForegroundColor Cyan

    if ($WithCuda) {
        Write-Host "CUDA ondersteuning ingeschakeld" -ForegroundColor Yellow
        cargo tauri build --features cuda
    } else {
        cargo tauri build
    }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Build voltooid!" -ForegroundColor Green
    Write-Host "  Installer: src-tauri/target/release/bundle/" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Setup voltooid. Start development met:" -ForegroundColor Green
    Write-Host "  cargo tauri dev" -ForegroundColor White
}
