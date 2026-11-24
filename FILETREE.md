# File Tree — FabGUI

## Project root (`/home/gamer/projects/FabGUI/`)
- `server.py` — Python HTTP server + FabCLI wrapper (serves static/, API endpoints incl. /api/auth/*)
- `static/index.html` — page structure, header, download modal, auth panel (tab-auth), background-lines SVG, downloads table (#jobsTable)
- `static/app.js` — library loading, search, filters, sorting, card behavior, download flow, auth UI; exposes helpers on `window`
- `static/style.css` — shared styling (theme vars, cards, modal, toast, downloads table)
- `static/appearance.css` — liquid-glass styling + procedural line animations (come-and-leave), --panel-radius CSS var
- `static/appearance.js` — appearance settings UI + liquid-gl@3.0.0 factory init (tint/frost/refraction/radius/smooth/dim)
- `static/interaction-fix.js` — click handling so download dialog opens over glass canvas; calls `window.addJobRow`/`window.toast` for progress + toast
- `static/engine-sort.js` — engine-cap filter/sort overrides
- `static/LIQUIDGL-NOTICE.txt` — liquid-gl loaded from jsDelivr CDN (not vendored); MIT, © NaughtyDuk
- `settings.json` — runtime settings (fabcli_path, download_dir)
- `README.md` — installation, usage, appearance, troubleshooting docs
- `install.sh` / `update.sh` — Arch/CachyOS installer & updater
- `LICENSE`, `.gitignore`, `docs/screenshots/`, `SESSION.md`, `FILETREE.md`

## Live install (`~/.local/share/fabgui/`) — what actually runs on port 8000
- Identical to project `static/` + `server.py` + `settings.json` (kept in sync after each change).
- Running as `fabgui.service` (systemd user unit), serves http://127.0.0.1:8000.
