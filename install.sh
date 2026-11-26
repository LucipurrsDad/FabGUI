#!/usr/bin/env bash
# FabGUI userspace installer for pacman and apt based Linux desktops.
set -euo pipefail

FABGUI_DIR="$HOME/.local/share/fabgui"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/fabgui.service"

if [[ $EUID -eq 0 ]]; then
  echo "Error: do not run this installer with sudo or as root." >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Error: cannot detect the distribution without /etc/os-release." >&2
  exit 1
fi
# /etc/os-release defines shell-compatible assignments.
source /etc/os-release
case " ${ID-} ${ID_LIKE-} " in
  *" arch "*|*" cachyos "*)
    manager=pacman
    packages=(python webkit2gtk-4.1 ffmpeg)
    ;;
  *" debian "*|*" ubuntu "*)
    manager=apt-get
    packages=(python3 libwebkit2gtk-4.1-0 ffmpeg)
    ;;
  *)
    echo "Error: unsupported distribution (${PRETTY_NAME:-unknown}). FabGUI supports Arch/pacman and Debian or Ubuntu/apt systems." >&2
    exit 1
    ;;
esac

tools=("$manager" systemctl)
if [[ $manager == apt-get ]]; then tools+=(dpkg-query); fi
for tool in "${tools[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Error: '$tool' is required on ${PRETTY_NAME:-this distribution}." >&2
    exit 1
  fi
done
if ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "Error: no systemd user session is available. Run this installer from your logged-in desktop session." >&2
  exit 1
fi

missing=()
for package in "${packages[@]}"; do
  if [[ $manager == pacman ]]; then
    pacman -Q "$package" >/dev/null 2>&1 || missing+=("$package")
  elif [[ $(dpkg-query -W -f='${Status}' "$package" 2>/dev/null) != "install ok installed" ]]; then
    missing+=("$package")
  fi
done

echo "==> FabGUI installer for ${PRETTY_NAME:-Linux}"
echo "==> Target: $FABGUI_DIR"
if ((${#missing[@]})); then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "Error: install the missing system packages as an administrator using $manager: ${missing[*]}" >&2
    exit 1
  fi
  echo "==> Installing missing packages: ${missing[*]}"
  if [[ $manager == pacman ]]; then
    sudo pacman -S --needed "${missing[@]}" || { echo "Error: pacman could not install the required packages." >&2; exit 1; }
  else
    if ! sudo apt-get update || ! sudo apt-get install --no-upgrade "${missing[@]}"; then
      echo "Error: apt could not install the required packages. Check that your release provides libwebkit2gtk-4.1-0." >&2
      exit 1
    fi
  fi
fi

export PATH="$HOME/.local/bin:$PATH"
if [[ ! -x /usr/bin/python3 ]] || ! /usr/bin/python3 -c 'import sys; sys.exit(sys.version_info < (3, 8))'; then
  echo "Error: FabGUI requires Python 3.8 or newer at /usr/bin/python3." >&2
  exit 1
fi
fabcli_path="$(/usr/bin/python3 - "$FABGUI_DIR/settings.json" <<'PY'
import json
import shutil
import sys
from pathlib import Path

try:
    configured = json.loads(Path(sys.argv[1]).read_text()).get("fabcli_path", "fabcli")
except (OSError, ValueError, AttributeError):
    configured = "fabcli"
print(shutil.which(configured if isinstance(configured, str) and configured else "fabcli") or "")
PY
)"
if [[ -z "$fabcli_path" ]]; then
  echo "Error: FabCLI was not found. Install it first (for example in ~/.local/bin) and verify 'fabcli --help'." >&2
  exit 1
fi
fabcli_dir="$(cd -- "$(dirname -- "$fabcli_path")" && pwd)"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "==> Installing FabGUI from $SCRIPT_DIR"
mkdir -p "$FABGUI_DIR" "$SERVICE_DIR"
if [[ -f "$FABGUI_DIR/static/backgrounds/user-video.mp4" && ! -e "$FABGUI_DIR/user-video.mp4" ]]; then
  mv "$FABGUI_DIR/static/backgrounds/user-video.mp4" "$FABGUI_DIR/user-video.mp4"
fi
install -m 755 "$SCRIPT_DIR/server.py" "$FABGUI_DIR/server.py"
rm -rf "$FABGUI_DIR/static"
cp -a "$SCRIPT_DIR/static" "$FABGUI_DIR/static"
if [[ ! -e "$FABGUI_DIR/settings.json" && -f "$SCRIPT_DIR/settings.json" ]]; then
  cp -a "$SCRIPT_DIR/settings.json" "$FABGUI_DIR/settings.json"
fi
cp -a "$SCRIPT_DIR/README.md" "$FABGUI_DIR/README.md" 2>/dev/null || true

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=FabGUI - FabCLI Web Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 "$FABGUI_DIR/server.py"
WorkingDirectory=$FABGUI_DIR
Restart=on-failure
RestartSec=5
Environment=FABGUI_PORT=8000
Environment=FABGUI_FABCLI=fabcli
Environment="PATH=$fabcli_dir:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"

[Install]
WantedBy=default.target
EOF

if [[ -f "$HOME/.bashrc" ]] && ! grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.bashrc"; then
  printf '\n# User-installed commands such as FabCLI\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.bashrc"
fi

systemctl --user daemon-reload
systemctl --user enable fabgui.service
systemctl --user restart fabgui.service

echo
echo "==> FabGUI installed"
echo "==> Open http://127.0.0.1:8000"
echo "==> After a fresh shell login, verify: fabcli --help"
