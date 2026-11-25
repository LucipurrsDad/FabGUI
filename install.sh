#!/usr/bin/env bash
# FabGUI installer for Arch Linux, CachyOS, and other Arch-based systems.
set -euo pipefail

FABGUI_DIR="$HOME/.local/share/fabgui"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/fabgui.service"

if ! command -v pacman >/dev/null 2>&1; then
  echo "Error: FabGUI's installer currently supports Arch Linux and Arch-based distributions." >&2
  echo "CachyOS users should run this installer from CachyOS; other distributions need matching packages for WebKitGTK 4.1." >&2
  exit 1
fi

if [[ -f /etc/cachyos-release ]]; then
  DISTRO="CachyOS"
else
  DISTRO="Arch Linux / Arch-based"
fi

if [[ $EUID -eq 0 ]]; then
  echo "Error: do not run this installer with sudo or as root." >&2
  exit 1
fi

if ! command -v fabcli >/dev/null 2>&1 && [[ ! -x "$HOME/.local/bin/fabcli" ]]; then
  echo "Warning: fabcli was not found on PATH or in $HOME/.local/bin." >&2
  echo "Install FabCLI first, then rerun this installer."
fi

echo "==> FabGUI installer for $DISTRO"
echo "==> Target: $FABGUI_DIR"
mkdir -p "$FABGUI_DIR" "$SERVICE_DIR"

echo "==> Installing FabCLI runtime packages"
sudo pacman -S --needed webkit2gtk-4.1 harfbuzz-icu libmanette hyphen ffmpeg

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "==> Installing FabGUI from $SCRIPT_DIR"
install -m 755 "$SCRIPT_DIR/server.py" "$FABGUI_DIR/server.py"
rm -rf "$FABGUI_DIR/static"
cp -a "$SCRIPT_DIR/static" "$FABGUI_DIR/static"
cp -a "$SCRIPT_DIR/settings.json" "$FABGUI_DIR/settings.json" 2>/dev/null || true
cp -a "$SCRIPT_DIR/README.md" "$FABGUI_DIR/README.md" 2>/dev/null || true

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=FabGUI - FabCLI Web Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 $FABGUI_DIR/server.py
WorkingDirectory=$FABGUI_DIR
Restart=on-failure
RestartSec=5
Environment=FABGUI_PORT=8000
Environment=FABGUI_FABCLI=fabcli
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF

if [[ -f "$HOME/.bashrc" ]] && ! grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.bashrc"; then
  printf '\n# User-installed commands such as FabCLI\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.bashrc"
fi

systemctl --user daemon-reload
systemctl --user enable --now fabgui.service

echo
echo "==> FabGUI installed"
echo "==> Open http://127.0.0.1:8000"
echo "==> After a fresh shell login, verify: fabcli --help"
