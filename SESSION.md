# Session Tracker — FabGUI

## Current build stage

Release candidate installed locally at <http://127.0.0.1:8000> as the
`fabgui.service` user service. Source remains local, awaiting approval to push.

## What was done

- Compared the checked-in LiquidGL integration with the local reference demos.
  Replaced the capped, DOM-snapshot lens lifecycle with one viewport WebGL 2
  renderer. Glass uses Snell's law, CSS-pixel bevels, and a reused backdrop
  texture. The renderer idles for static scenes and updates video from decoded
  frames. LiquidGL's former adapter probe caused the WebGPU warning. The sync
  XHR warning comes from AdGuard's content script.
- Simplified Appearance into Background, Glass, Motion, and Presets tabs.
  Video upload and playback share one panel. Added the 40th Anniversary
  wallpaper, optional effects, custom presets, and a 6 px default frost.
  Existing browser settings and the installed wallpaper video were preserved.
- Added the Chromium PWA install prompt, branded launcher icons, and a
  network-only service worker. Fixed running-job serialization and completion
  percentages; private API responses and video use `no-store`. All notification
  toasts use the shared optics and dismiss automatically after eight seconds.
- Expanded the installer to pacman and apt, and kept the public-main update
  flow while preserving installed settings and video.
- Added a four-second README loop rendered by the production WebGL shader
  with 2 px frost and 15% edge curvature. The shareable 720p H.264 export is
  `~/Videos/FabGUI-glass-demo-720p.mp4`.
- Created a translucent graphite FAB icon for the app header, browser tab,
  PWA manifest, and installed Brave launcher in KDE.
- Kept the download progress pane docked for ten seconds after the last
  download finishes, so its final status stays visible.
- Updated the README showcase with the graphite icon, standalone KDE launcher,
  download formats and status timing, and verified Linux test coverage.
- Added a ten-second Qt Quick showcase cycling Crystal, Prism, and Aurora
  through the production WebGL renderer. The README embeds the recorded loop
  and links the runnable example.

## Verification

- Chromium: 604-card library, repeated bidirectional scroll with 55 cards in
  view, live smooth scrolling in both directions, resize/DPR changes, matching
  bevel pixel samples on narrow and wide panes, no idle repaint with a static
  backdrop, filtering, sorting, refresh, presets, and settings migration.
- Chromium: MP4 upload, playback, pause, restart, rate and loop settings,
  removal, and playback of the existing installed wallpaper clip.
- On the live service, error, loading, success, and info toasts each rendered
  the rounded optical backdrop and dismissed in about eight seconds.
- Chrome native PWA installation generated a Linux `.desktop` launcher;
  launching it opened the live service in standalone mode. A stopped-backend
  test confirmed the offline message and an empty Cache Storage.
- Live FabCLI: Complete Project, Code Plugin and Asset Pack downloads completed,
  including a retest of the updated 100% progress display. Account and session
  checks succeeded on the existing login.
- CachyOS: real package detection and service reinstall, with settings and video
  preserved. Ubuntu 24.04 container: actual apt installation of all three
  package dependencies and skip-on-reinstall; systemd was stubbed in the container.
  A local archive fixture verified the updater's asset replacement, preservation,
  and service restart request.
- Demo media: decoded all 56 distinct GIF frames and verified the 1280×720,
  30 fps MP4. Both exports use the same four-second sequence.
- The live service serves the new SVG and all three manifest icons. The
  existing Brave launcher and desktop shortcut resolve the `fabgui` icon from
  the user's KDE icon lookup and keep their app ID. The Plasma shell refreshed
  with the existing pin intact and without restarting KWin or FabGUI.
- On the live page, Chromium kept the dock visible for ten seconds after the
  latest completion and reset the timer for a new job started during the wait.
- The user confirmed the installed Brave PWA, download behavior, and KDE icon
  on their desktop.
- The QML showcase rendered all three modes in Qt WebEngine, and its native
  pause, resume, and replay shortcuts worked in the test window. Qt WebEngine
  decoded the embedded animated WebP, verified at 160 frames and 10,000 ms.

## Next steps

- Review the local release before publishing. Fresh interactive Epic sign-in
  and other distribution versions were not exercised.
