#!/usr/bin/env bash
# Update an existing FabGUI installation from the latest public GitHub main branch.
set -euo pipefail

REPOSITORY="LucipurrsDad/FabGUI"
BRANCH="main"
INSTALL_DIR="${FABGUI_DIR:-$HOME/.local/share/fabgui}"
ARCHIVE_URL="https://github.com/${REPOSITORY}/archive/refs/heads/${BRANCH}.tar.gz"

if [[ -z "${HOME:-}" || "$HOME" == "/root" ]]; then
  echo "Error: run this updater as the user who owns the FabGUI installation, not as root." >&2
  exit 1
fi

for tool in curl tar; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Error: required command '$tool' is not installed." >&2
    exit 1
  fi
done

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
ARCHIVE="$WORK_DIR/fabgui-main.tar.gz"

printf '==> Downloading FabGUI %s from %s\n' "$BRANCH" "$REPOSITORY"
curl --fail --location --silent --show-error --retry 3 "$ARCHIVE_URL" --output "$ARCHIVE"
tar -xzf "$ARCHIVE" -C "$WORK_DIR"
SOURCE_DIR="$WORK_DIR/FabGUI-${BRANCH}"

if [[ ! -f "$SOURCE_DIR/server.py" || ! -d "$SOURCE_DIR/static" ]]; then
  echo "Error: downloaded archive did not contain FabGUI server.py and static/." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
install -m 755 "$SOURCE_DIR/server.py" "$INSTALL_DIR/server.py"
# Replace frontend assets to remove obsolete files while leaving user settings intact.
rm -rf "$INSTALL_DIR/static"
cp -a "$SOURCE_DIR/static" "$INSTALL_DIR/static"

printf '==> Updated FabGUI files in %s\n' "$INSTALL_DIR"
if command -v systemctl >/dev/null 2>&1 && systemctl --user cat fabgui.service >/dev/null 2>&1; then
  systemctl --user restart fabgui.service
  echo "==> Restarted fabgui.service"
else
  echo "==> No fabgui.service was found; restart your manually launched server to load the update."
fi

echo "==> Done. Hard-refresh the page (Ctrl+F5) if the browser still shows the old UI."
