# FabGUI

A self-hosted web GUI for [FabCLI](https://github.com/zirklerite/FabCLI) — the Epic Games / Fab asset downloader for Linux.

FabGUI wraps the `fabcli` binary behind a small local web server and gives you a browser UI for:

- **Owned assets** — lists every asset you've claimed with FabCLI, sorted alphabetically, with thumbnails
- **Download** — click any asset (picture or title) to open the download prompt into your configured folder
- **Copy UID** — right-click any asset to copy its listing UID to the clipboard (toast confirms)
- **Authentication** — sign in / out with Epic / Fab, view session status, expiry, and account info
- **Settings** — configure the download folder (saved to `settings.json`, persists between restarts)

Everything runs on your machine via the local `fabcli` binary; no API keys or extra services needed.

## What changed from the original FabGUI

- **Card layout** — assets display as cards (image + title) instead of a table, filling the full viewport width
- **Click to download** — clicking a card opens the download modal
- **Right-click to copy UID** — copies the listing UID with a centered toast confirmation
- **Help button** — in the header next to the logo, explains how to use the site
- **Removed** — top nav tabs, search bar, filters, "I've claimed it" checkbox, Library tab, Downloads tab, FabCLI binary field, Price/Owned columns, themes

## Requirements

- `fabcli` installed and on your `PATH` (see the [FabCLI README](https://github.com/zirklerite/FabCLI#readme))
- Python 3.8+ (stdlib only — no `pip install` needed)
- Shared libraries: `libwebkit2gtk-4.1.so.0`, `libjavascriptcoregtk-4.1.so.0`, `libharfbuzz-icu.so.0`, `libmanette-0.2.so.0`, `libhyphen.so.0`
- A graphical environment for the Fab login webview

## Install

Run the included install script. It downloads the required shared-library packages from the Arch Linux archive, extracts them into `~/.local/lib/`, installs FabGUI, and sets up a systemd user service:

```bash
git clone https://github.com/LucipurrsDad/FabGUI.git
cd /home/$USER/FabGUI
chmod +x install.sh
./install.sh
```

The script will:

1. Create `~/.local/lib/` if it doesn't exist
2. Download and extract `webkit2gtk`, `harfbuzz-icu`, `libmanette`, and `hyphen` packages
3. Copy all `*.so` files into `~/.local/lib/`
4. Install FabGUI files to `~/.local/share/fabgui/`
5. Create and enable a systemd user service at `~/.config/systemd/user/fabgui.service`
6. Start the service

Then open <http://127.0.0.1:8000> in your browser.

### Manual install

If you prefer not to use the script:

```bash
mkdir -p ~/.local/lib
# Copy the required .so files into ~/.local/lib/
cp server.py static/ settings.json ~/.local/share/fabgui/
# Then run:
python3 ~/.local/share/fabgui/server.py
```

## Run

If using the systemd user service:

```bash
systemctl --user start fabgui
systemctl --user enable fabgui
systemctl --user status fabgui
```

Then open <http://127.0.0.1:8000> in your browser.

## Configuration

Settings (download folder) are saved to `settings.json` and persist between restarts.

Environment variables:

- `FABGUI_PORT` — port to listen on (default `8000`)
- `FABGUI_FABCLI` — path to the `fabcli` executable (default `fabcli`)

## Layout

- `server.py` — stdlib HTTP server + subprocess wrapper around `fabcli`
- `static/index.html` — the GUI page
- `static/style.css` — styling
- `static/app.js` — UI logic
- `settings.json` — runtime settings (download folder)
- `install.sh` — automated installer

## License

MIT
