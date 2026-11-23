# FabGUI

A self-hosted web GUI for [FabCLI](https://github.com/zirklerite/FabCLI) — the Epic Games / Fab asset downloader for Linux.

FabGUI provides a browsable owned library with search, engine/category/format/platform filters, newest-engine and alphabetical sorting, card metadata, downloads, UID copying, and authentication status.

## Platform support

The included installer is for **Arch Linux, CachyOS, and other Arch-based distributions** using `pacman`. It does not support Debian, Ubuntu, Fedora, or other package families; on those distributions, install the equivalent WebKitGTK 4.1 and GTK runtime packages manually.

## FabCLI dependencies on Arch

Install FabCLI first, then install its Linux runtime dependencies with:

```bash
sudo pacman -S --needed webkit2gtk-4.1 harfbuzz-icu libmanette hyphen
```

If FabCLI is in `~/.local/bin`, put it on your shell and systemd user-service PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

For Bash, persist that with:

```bash
grep -qxF 'export PATH="$HOME/.local/bin:$PATH"' ~/.bashrc || \
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

Verify:

```bash
which fabcli
fabcli --help
ldd "$(which fabcli)" | grep "not found" && false || true
```

## Install

```bash
git clone https://github.com/LucipurrsDad/FabGUI.git
cd FabGUI
chmod +x install.sh
./install.sh
```

The installer:

1. verifies that it is running on an Arch-based system;
2. refuses to run as root;
3. checks for FabCLI;
4. installs FabCLI runtime libraries through `pacman`;
5. copies FabGUI into `~/.local/share/fabgui`;
6. creates `~/.config/systemd/user/fabgui.service`;
7. enables and starts the service.

Then open <http://127.0.0.1:8000>.

## Updating an existing installation

```bash
cd /path/to/FabGUI
git pull --ff-only
./install.sh
```

For an immediate refresh of only the installed web files:

```bash
cp -r static server.py settings.json README.md ~/.local/share/fabgui/
systemctl --user restart fabgui
```

Then hard-refresh the browser with **Ctrl+F5**.

## Library filtering

Filter options are generated from `fabcli library` in the user's installed library. Engine, category, format, platform, search, and sorting selections are remembered in browser local storage.

`Latest engine` uses the highest engine version listed in `projectVersions`; it does not determine whether an item is a complete Unreal project. Categories and `distributionMethod` are Fab metadata and can be broad or change upstream.

## Run manually

```bash
python3 ~/.local/share/fabgui/server.py
```

Or manage the systemd user service:

```bash
systemctl --user start fabgui
systemctl --user enable fabgui
systemctl --user restart fabgui
systemctl --user status fabgui
journalctl --user -u fabgui.service -n 100 --no-pager
```

## Layout

- `server.py` — Python HTTP server and FabCLI wrapper.
- `static/index.html` — GUI page.
- `static/style.css` — styling.
- `static/app.js` — library UI and filtering.
- `settings.json` — runtime settings.
- `install.sh` — Arch/CachyOS installer.

## License

MIT
