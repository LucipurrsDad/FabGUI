# Session Tracker — FabGUI

## Current build stage
All fixes implemented, synced to live install (~/.local/share/fabgui), fabgui.service restarted. Page loads with 0 console errors. All features verified present in served HTML.

## What was done (this session)

### 1. Download bug — FIXED
Root cause: `static/interaction-fix.js` uses capture-phase `stopImmediatePropagation` on the Download button, so its own `startDownload()` runs instead of app.js's `confirmDownload()`. app.js's helpers were never reached.
- Exposed `window.api`, `window.state`, `window.openDownloadModal`, `window.addJobRow`, `window.watchJob`, `window.openEventSource`, `window.fmtBytes`, `window.toast`, `window.slugify` in app.js.
- Added missing `slugify()` function to app.js.
- interaction-fix.js's `startDownload` now calls `window.addJobRow()` and `window.toast()` so download progress and toast work through the actual code path that runs.
- Also fixed live `settings.json`: `download_dir` was `/home/$USER` (literal) → reset to `~/Downloads`; `resolve_download_dir()` in server.py now handles `$USER`/`${USER}`/`~`.

### 2. Auth section — FIXED
Added `tab-auth` panel at bottom of page with Epic session / Fab session / Account cards + Sign in / Sign out buttons, wired to `/api/auth/status`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/whoami`.

### 3. Progress indicator — ADDED
Added `#jobsTable` / `#jobsBody` downloads table below the library results with progress bars. `addJobRow()` creates a row when a download starts; `updateJobProgress()` updates the bar; rows marked Complete/Failed on finish.

### 4. Moving lines — IMPROVED
Replaced 6 static SVG paths with 12 procedural glass lines that flow across, fade in, then fade out and leave (staggered speed/direction/color/opacity/delay). New `line-flow` (stroke-dashoffset) and `line-come` (opacity come-and-leave) keyframes in appearance.css.

### 5. Refraction / clearer glass settings — ADDED
- liquid-gl was hardcoded `refraction: 0` (not rendering) and `frost: 2` (too frosted).
- Added Refraction slider (0–1, default 0.03) and Softness slider (0–4, default 0.5).
- Added Corner radius (0–32px, default 12) and Corner smoothness (0–2, default 0.6) sliders, applied as `--panel-radius`/`--panel-smooth` CSS vars on the library panel.
- Lowered Glass tint default from 36 → 24 for clearer, less frosted glass (closer to "nearly clear" liquidGL widget look).
- All settings persisted in localStorage.

### 6. Toast — VERIFIED
`window.toast` exposed on window, called from interaction-fix.js's `startDownload` and watchJob callbacks. Toast element present in HTML. 0 console errors.

### 7. README + tracking files updated
README documents authentication, appearance settings, liquid-gl CDN notice, updated file layout. SESSION.md and FILETREE.md maintained.

## Verification
- http://127.0.0.1:8000/ loads with 0 console errors (only unrelated Electron CSP warning)
- All HTML elements present: tint/frost/refraction/radius/smooth/dim sliders, toast, jobsTable, jobsBody, tab-auth, btnLogin, btnLogout
- 12 procedural background-lines paths
- app.js exposes all window helpers; interaction-fix.js calls window.addJobRow/window.toast
- appearance.js has radius/smooth in DEFAULTS, applies --panel-radius CSS var
- appearance.css uses border-radius: var(--panel-radius, 12px)
- /api/auth/status returns authenticated=true; /api/health download_dir=/home/gamer/Downloads
- project static/ and live ~/.local/share/fabgui/static/ identical (in sync)
- fabgui.service active on port 8000

## Remaining (optional)
- End-to-end test a real download once owned assets are in the Fab library
- Commit/push to GitHub (repo: LucipurrsDad/FabGUI)
