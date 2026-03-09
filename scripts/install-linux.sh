#!/bin/bash
# Open Speech Studio - Linux Installer Script
# Installs all dependencies and builds the application

set -e

WITH_CUDA=false
SKIP_BUILD=false

for arg in "$@"; do
    case $arg in
        --cuda) WITH_CUDA=true ;;
        --skip-build) SKIP_BUILD=true ;;
    esac
done

echo "========================================"
echo "  Open Speech Studio - Linux Setup"
echo "  OpenAEC Foundation"
echo "========================================"
echo ""

# Detect package manager
if command -v apt-get &> /dev/null; then
    PKG_MANAGER="apt"
elif command -v dnf &> /dev/null; then
    PKG_MANAGER="dnf"
elif command -v pacman &> /dev/null; then
    PKG_MANAGER="pacman"
else
    echo "[!] Geen ondersteunde package manager gevonden (apt/dnf/pacman)"
    exit 1
fi

echo "[INFO] Package manager: $PKG_MANAGER"

# 1. Install system dependencies
echo ""
echo "Systeem dependencies installeren..."

case $PKG_MANAGER in
    apt)
        sudo apt-get update
        sudo apt-get install -y \
            build-essential \
            curl \
            wget \
            libwebkit2gtk-4.1-dev \
            libssl-dev \
            libgtk-3-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev \
            libasound2-dev \
            pkg-config \
            cmake
        ;;
    dnf)
        sudo dnf install -y \
            gcc gcc-c++ \
            curl wget \
            webkit2gtk4.1-devel \
            openssl-devel \
            gtk3-devel \
            libappindicator-gtk3-devel \
            librsvg2-devel \
            alsa-lib-devel \
            cmake
        ;;
    pacman)
        sudo pacman -S --needed \
            base-devel \
            curl wget \
            webkit2gtk-4.1 \
            openssl \
            gtk3 \
            libappindicator-gtk3 \
            librsvg \
            alsa-lib \
            cmake
        ;;
esac

echo "[OK] Systeem dependencies geinstalleerd"

# 2. Install Node.js (via nvm if not present)
if ! command -v node &> /dev/null; then
    echo "[!] Node.js niet gevonden. Installeren via nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm install --lts
fi
echo "[OK] Node.js $(node --version)"

# 3. Install Rust
if ! command -v rustc &> /dev/null; then
    echo "[!] Rust niet gevonden. Installeren..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi
echo "[OK] Rust $(rustc --version)"

# 4. CUDA dependencies (optional)
if $WITH_CUDA; then
    echo ""
    echo "CUDA ondersteuning inschakelen..."
    if ! command -v nvcc &> /dev/null; then
        echo "[!] CUDA toolkit niet gevonden."
        echo "    Installeer CUDA via: https://developer.nvidia.com/cuda-downloads"
        echo "    Of gebruik --skip-cuda voor CPU-only modus"
    else
        echo "[OK] CUDA $(nvcc --version | grep release | awk '{print $6}')"
    fi
fi

# 5. Install npm dependencies
echo ""
echo "NPM dependencies installeren..."
npm install

# 6. Install Tauri CLI
echo "Tauri CLI installeren..."
cargo install tauri-cli --version "^2.0"

# 7. Build
if ! $SKIP_BUILD; then
    echo ""
    echo "Applicatie bouwen..."

    if $WITH_CUDA; then
        cargo tauri build --features cuda
    else
        cargo tauri build
    fi

    echo ""
    echo "========================================"
    echo "  Build voltooid!"
    echo "  Installer: src-tauri/target/release/bundle/"
    echo "========================================"
else
    echo ""
    echo "Setup voltooid. Start development met:"
    echo "  cargo tauri dev"
fi
