# FabGUI

A self-hosted web GUI for [FabCLI](https://github.com/zirklerite/FabCLI), the Epic Games / Fab asset downloader for Linux.

FabGUI provides a browsable owned library with search, engine/category/format/platform filters, newest-engine and alphabetical sorting, card metadata, downloads, UID copying, and authentication status.

## Platform support

The included installer targets **Arch Linux, CachyOS, and other Arch-based distributions** using `pacman`. It does not install dependencies on Debian, Ubuntu, Fedora, or other package families; on those systems, install compatible FabCLI WebKitGTK 4.1 runtime packages manually.

## FabCLI dependencies on Arch

Install FabCLI first. If it is installed in `~/.local/bin`, add that directory to your shell PATH (and reopen the terminal):

```bash
grep -qxF 'export PATH="$HOME/.local/bin:$PATH"' ~/.bashrc || \
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

Install FabCLI's runtime libraries from your current distro repositories—do not copy old library packages from an Arch archive:

```bash
sudo pacman -S --needed webkit2gtk-4.1 harfbuzz-icu libmanette hyphen
```

Verify FabCLI is available and its shared libraries resolve:

```bash
command -v fabcli
fabcli --help
ldd "$(command -v fabcli)" | grep 'not found' || true
```

## Fresh install

```bash
git clone https://github.com/LucipurrsDad/FabGUI.git
cd FabGUI
chmod +x install.sh
./install.sh
```

The installer checks for `pacman`, installs FabCLI's runtime dependencies, copies FabGUI to `~/.local/share/fabgui`, and enables the `fabgui.service` systemd user unit. It preserves an existing `settings.json`. Run it as your normal user; it invokes `sudo` only for `pacman`.

Open <http://127.0.0.1:8000> after installation.

## Update an existing installation

You do not need to keep a Git checkout. Download and run the updater directly:

```bash
curl -fsSL https://raw.githubusercontent.com/LucipurrsDad/FabGUI/main/update.sh | bash
```

Or, if you cloned the repository, run its updater:

```bash
cd /path/to/FabGUI
./update.sh
```

The updater downloads the latest `main` archive from GitHub, replaces the installed `server.py` and `static/` files in `~/.local/share/fabgui`, preserves user settings, and restarts the systemd user service if present. For a non-default installation directory, set `FABGUI_DIR` when running the script. Hard-refresh the page with **Ctrl+F5** if the browser still shows cached files.

## Library filtering

Filter options are generated from the user's `fabcli library` response. Engine, category, distribution format, platform, search, and sort selections are remembered in browser local storage. Categories and `distributionMethod` come from Fab metadata and may be broad or change upstream. “Latest engine” sorts by the highest version in `projectVersions`; it does not identify a complete Unreal project.

## Run and troubleshoot

```bash
systemctl --user status fabgui.service
systemctl --user restart fabgui.service
journalctl --user -u fabgui.service -n 100 --no-pager
```

Open <http://127.0.0.1:8000>. To run without systemd, use:

```bash
python3 ~/.local/share/fabgui/server.py
```

## Layout

- `server.py` — Python HTTP server and FabCLI wrapper.
- `static/` — GUI HTML, JavaScript, CSS, and image assets.
- `settings.json` — runtime settings.
- `install.sh` — Arch/CachyOS installer.
- `update.sh` — downloads and installs the latest public `main` version.

## License

MIT
