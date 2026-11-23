# FabGUI

A self-hosted web GUI for [FabCLI](https://github.com/zirklerite/FabCLI) — the Epic Games / Fab asset downloader for Linux.

FabGUI wraps the `fabcli` binary behind a small local web server and gives you a browser UI for:

- **Owned library** — browse owned Fab items as image cards.
- **Search and filters** — search titles, categories, IDs and descriptions; filter by Unreal Engine version, Fab category, distribution format, and target platform.
- **Sorting** — sort by the highest listed engine version or alphabetically. The selected view and filters are remembered in the browser.
- **Card metadata** — see the latest listed engine version, category, and distribution format at a glance.
- **Download** — click an item to open the download prompt.
- **Copy UID** — right-click a card to copy its listing UID.
- **Authentication** — sign in / out with Epic / Fab, view session status, expiry, and account info.

Filter options and category counts are built from the current `fabcli library` response. Categories reflect Fab's metadata and may be broad; distribution format (`distributionMethod`, e.g. `ASSET_PACK`) is a separate field. “Latest engine” sorts by each item's highest `engineVersions` value; it does not classify an item as a complete Unreal project.

Everything runs on your machine via the local `fabcli` binary; no API keys or extra services needed.

## Requirements

- `fabcli` installed and on your `PATH` (see the [FabCLI README](https://github.com/zirklerite/FabCLI#readme)).
- Python 3.8+ (stdlib only — no `pip install` needed).
- FabCLI's WebKit runtime dependencies and a graphical environment for its login webview. On current Arch-based distributions such as CachyOS, install the system packages with `sudo pacman -S webkit2gtk-4.1 harfbuzz-icu libmanette hyphen` rather than using libraries copied from an old Arch archive.

## Install

Run the included install script to install FabGUI and set up a systemd user service:

```bash
cd /path/to/FabGUI
chmod +x install.sh
./install.sh
```

Then open <http://127.0.0.1:8000> in your browser.

If FabCLI was installed to `~/.local/bin`, ensure that directory is on `PATH` for both your shell and the systemd user service. For Bash, add this line to `~/.bashrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

The installer configures the service `PATH` to include `~/.local/bin`.

### Manual install

```bash
mkdir -p ~/.local/share/fabgui
cp -r server.py static settings.json ~/.local/share/fabgui/
python3 ~/.local/share/fabgui/server.py
```

## Run

```bash
systemctl --user start fabgui
systemctl --user enable fabgui
systemctl --user status fabgui
```

Then open <http://127.0.0.1:8000> in your browser.

## Configuration

Settings are saved to `settings.json` and persist between restarts.

Environment variables:

- `FABGUI_PORT` — port to listen on (default `8000`).
- `FABGUI_FABCLI` — path to the `fabcli` executable (default `fabcli`).

## Layout

- `server.py` — stdlib HTTP server + subprocess wrapper around `fabcli`.
- `static/index.html` — GUI page.
- `static/style.css` — styling.
- `static/app.js` — UI logic.
- `settings.json` — runtime settings.
- `install.sh` — automated installer.

## License

MIT
