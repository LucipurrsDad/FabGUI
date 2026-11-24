# FabGUI
<img width="3840" height="2100" alt="Screenshot_20261123_192500" src="https://github.com/user-attachments/assets/88e010c3-e3d4-4f49-b7fb-7995d85e0cb7" />

A self-hosted web app for [FabCLI](https://github.com/zirklerite/FabCLI), the Epic Games / Fab asset downloader for Linux. FabGUI turns your owned Fab library into a searchable, sortable visual catalog, with direct download and authentication controls.

## Features

- **Visual owned library** — browse owned Fab items in a responsive card grid with thumbnails and metadata.
- **Header sort tabs** — switch between **Latest engine** (highest Unreal Engine version listed first) and **A–Z**. The tabs are centered in the page header and the selected sort is remembered.
- **Search and filters** — search titles, categories, IDs, and descriptions; filter by engine version, Fab category, distribution format, and target platform. Filter options and counts are built from the current `fabcli library` response.
- **At-a-glance metadata** — cards show the latest listed engine version, category, and distribution format.
- **Download** — click a card to open the download prompt (engine version, platform, target folder).
- **Copy listing UID** — right-click a card to copy its Fab listing UID.
- **Authentication** — sign in or out and view Epic/Fab session and account status (auth panel at the bottom of the page).
- **Appearance / liquid glass** — animated procedural line background plus a glass lens over the library. Tunable glass tint, softness (frost), refraction, and background dimming; choices persist in browser localStorage.
- **Remembered view** — search, filters, and sort selection persist in browser local storage.

Fab's categories and distribution metadata can be broad or change upstream. The highest listed engine version is a sorting convenience; it does not mean every item is a complete Unreal project. FabGUI lists items returned by FabCLI's owned library and does not currently filter projects from other asset types by a separate project-only flag.

## Platform support

The included installer targets **Arch Linux, CachyOS, and other Arch-based distributions** using `pacman`. The installer does not install dependencies on Debian, Ubuntu, Fedora, or other package families; on those systems, install compatible FabCLI WebKitGTK 4.1 runtime packages manually.

FabGUI requires Python 3.8+ (standard library only) and FabCLI. FabCLI's Linux WebView needs the following Arch packages:

```bash
sudo pacman -S --needed webkit2gtk-4.1 harfbuzz-icu libmanette hyphen
```

If FabCLI is installed in `~/.local/bin`, make sure that path is in your shell PATH. For Bash:

```bash
grep -qxF 'export PATH="$HOME/.local/bin:$PATH"' ~/.bashrc || \
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

Verify FabCLI is discoverable and its linked libraries resolve:

```bash
command -v fabcli
fabcli --help
ldd "$(command -v fabcli)" | grep 'not found' || true
```

## Fresh install

Install FabCLI first, then clone and install FabGUI as your normal user:

```bash
git clone https://github.com/LucipurrsDad/FabGUI.git
cd FabGUI
chmod +x install.sh
./install.sh
```

The installer checks for `pacman`, installs FabCLI's runtime packages, copies FabGUI to `~/.local/share/fabgui`, writes a systemd user unit, and enables and starts the service. It preserves an existing `settings.json`. It invokes `sudo` for `pacman`; do not run the installer itself with `sudo`.

Open <http://127.0.0.1:8000> after installation.

## Updating

No Git checkout is needed to update an existing installation. Run this as the account that owns FabGUI (not with `sudo`):

```bash
curl -fsSL https://raw.githubusercontent.com/LucipurrsDad/FabGUI/main/update.sh | bash
```

The updater downloads the latest public `main` archive, replaces the installed `server.py` and `static/` files in `~/.local/share/fabgui`, leaves settings intact, and restarts the `fabgui.service` user unit if present. To use a non-default install directory, set `FABGUI_DIR` before running the updater. Hard-refresh the browser (Ctrl+F5) if it still displays cached files.

## Run and troubleshoot

Manage the service from your regular desktop-user terminal. **Do not prefix `systemctl --user` with `sudo`**; `sudo` changes users and loses the desktop user's D-Bus session connection.

```bash
systemctl --user status fabgui.service
systemctl --user restart fabgui.service
journalctl --user -u fabgui.service -n 100 --no-pager
```

The service serves the installed copy at `~/.local/share/fabgui/server.py`. If you previously launched FabGUI manually from a source checkout, that old process may still own port 8000 and serve the old page while systemd repeatedly fails to bind the port. Check the listener and service:

```bash
sudo ss -ltnp 'sport = :8000'
systemctl --user status fabgui.service
```

If the listener is a manually started FabGUI process, stop that specific process (for example, press Ctrl+C in the terminal where it was launched, or terminate its confirmed PID), then start the managed unit:

```bash
systemctl --user reset-failed fabgui.service
systemctl --user start fabgui.service
```

Confirm the service is running and that it serves the updated header markup:

```bash
systemctl --user show fabgui.service -p MainPID
curl -fsS http://127.0.0.1:8000/ | grep -n 'header-sort-tabs'
```

To run without systemd, use `python3 ~/.local/share/fabgui/server.py` and make sure no other process is already listening on port 8000.

## Appearance settings

Click **Appearance** in the header to open the liquid-glass panel. Choices are saved in browser localStorage.

- **Use animated line background** — toggle the flowing procedural glass lines behind the page.
- **Glass tint** — neutral grey tint strength (0–75%). Higher means less transparent glass.
- **Softness (frost)** — surface blur of the glass lens (0–4). Lower = clearer glass.
- **Refraction** — light bending at the glass edge (0–1). `0` disables refraction; higher values bend light more while staying clear.
- **Background dimming** — dims the page background behind the glass (0–70%).

The glass lens uses [liquid-gl](https://github.com/naughtyduk/liquidGL) (v3.0.0, MIT) loaded from jsDelivr at runtime. The liquidGL source is not vendored in this repository; see `static/LIQUIDGL-NOTICE.txt`. If liquidGL fails to load, the page falls back to plain CSS glass styling.

## Layout

- `server.py` — Python HTTP server and FabCLI wrapper.
- `static/index.html` — page structure, header, download modal, auth panel, background lines.
- `static/app.js` — library loading, search, filters, sorting, card behavior, download flow, auth UI.
- `static/style.css` — shared styling.
- `static/appearance.css` — liquid-glass and procedural line animation styling.
- `static/appearance.js` — appearance settings UI and liquid-gl lens factory.
- `static/interaction-fix.js` — click handling so the download dialog opens over the glass canvas.
- `static/engine-sort.js` — engine-cap filter/sort overrides.
- `static/LIQUIDGL-NOTICE.txt` — liquidGL license/CDN notice.
- `settings.json` — runtime settings.
- `install.sh` — Arch/CachyOS installer.
- `update.sh` — updater for the latest public `main` version.

## License

MIT
