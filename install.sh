#!/usr/bin/env bash
# FabGUI installer
# Downloads required shared libraries from the Arch Linux archive,
# installs FabGUI, and sets up a systemd user service.
set -euo pipefail

ARCH="x86_64"
ARCHIVE="https://archive.archlinux.org"
FABGUI_DIR="$HOME/.local/share/fabgui"
LIB_DIR="$HOME/.local/lib"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/fabgui.service"

# Packages needed by fabcli (webkit2gtk frontend)
declare -A PKGS=(
  ["webkit2gtk"]="webkit2gtk/4.1-2.54.2-1/webkit2gtk-4.1-2.54.2-1-${ARCH}.pkg.tar.zst"
  ["harfbuzz-icu"]="harfbuzz-icu/15.1.0-1/harfbuzz-icu-15.1.0-1-${ARCH}.pkg.tar.zst"
  ["libmanette"]="libmanette/0.2.13-2/libmanette-0.2.13-2-${ARCH}.pkg.tar.zst"
  ["hyphen"]="hyphen/2.8.9-1/hyphen-2.8.9-1-${ARCH}.pkg.tar.zst"
)

echo "==> FabGUI installer"
echo "==> Target: $FABGUI_DIR"
echo "==> Libraries: $LIB_DIR"
echo "==> Note: folder picker requires python3-tk (install with: sudo apt install python3-tk)"

# --- create directories -------------------------------------------------
mkdir -p "$FABGUI_DIR" "$LIB_DIR" "$SERVICE_DIR"

# --- download and extract shared libraries ------------------------------
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

for name in "${!PKGS[@]}"; do
  url="${ARCHIVE}/packages/${PKGS[$name]}"
  tarball="$WORK/${name}.pkg.tar.zst"
  echo "==> Downloading $name ..."
  curl -fL "$url" -o "$tarball"
  echo "==> Extracting $name ..."
  mkdir -p "$WORK/${name}-extract"
  tar --zstd -xf "$tarball" -C "$WORK/${name}-extract"
  echo "==> Copying *.so files from $name to $LIB_DIR ..."
  find "$WORK/${name}-extract" -name '*.so*' -exec cp -v {} "$LIB_DIR/" \;
done

echo "==> Libraries installed to $LIB_DIR"

# --- install FabGUI files ------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "==> Installing FabGUI from $SCRIPT_DIR to $FABGUI_DIR ..."
cp -v "$SCRIPT_DIR/server.py" "$FABGUI_DIR/"
cp -rv "$SCRIPT_DIR/static" "$FABGUI_DIR/"
cp -v "$SCRIPT_DIR/settings.json" "$FABGUI_DIR/" 2>/dev/null || true
cp -v "$SCRIPT_DIR/README.md" "$FABGUI_DIR/" 2>/dev/null || true

# --- systemd user service -----------------------------------------------
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
Environment=PATH=$HOME/.local/bin:/usr/bin:/bin
Environment=LD_LIBRARY_PATH=$LIB_DIR

[Install]
WantedBy=default.target
EOF

echo "==> Service file written to $SERVICE_FILE"

# --- reload and start ----------------------------------------------------
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload
  systemctl --user enable fabgui.service
  systemctl --user restart fabgui.service
  echo "==> FabGUI service started. Open http://127.0.0.1:8000"
else
  echo "==> systemctl not found. Start manually:"
  echo "    cd $FABGUI_DIR && python3 server.py"
  echo "    Then open http://127.0.0.1:8000"
fi

echo "==> Done."
