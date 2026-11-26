# File Tree — FabGUI

```text
FabGUI/
├── .gitignore                         Ignore caches and local video files
├── FILETREE.md                        Repository layout and file purposes
├── LICENSE                            FabGUI's MIT license
├── README.md                          Installation, PWA, appearance and troubleshooting
├── SESSION.md                         Local release progress and verification
├── Screenshot_20261126_030158.png      Existing UI screenshot
├── Screenshot_20261126_030433.png      Existing UI screenshot
├── install.sh                         Userspace installer for pacman, apt, and DNF distributions
├── server.py                          Loopback HTTP service, FabCLI jobs and background videos
├── settings.json                      Default local FabCLI and download directory settings
├── update.sh                          Updater for the latest public main archive
├── backgrounds/
│   ├── Gold-Gate-wallpaper-dark.png     Dark Gold-Gate source wallpaper
│   ├── Gold-Gate-wallpaper.png          Light Gold-Gate source wallpaper
│   └── zelda40th.jpg                    40th Anniversary source wallpaper
├── docs/
│   ├── demos/
│   │   ├── FabGUIShowcase.qml          Qt Quick window and ten-second playback controls
│   │   ├── fabgui-showcase.webp        Recorded showcase loop embedded in the README
│   │   └── glass-showcase.html         Crystal, Prism and Aurora scene using the app shader
│   └── screenshots/
│       ├── fabgui-glass-demo.gif        Looping liquid-glass demo for the README
│       └── fabgui-pre-liquid-glass.png  Screenshot of the original UI
└── static/
    ├── LIQUIDGL-NOTICE.txt             Attribution for the adapted LiquidGL optics
    ├── app.js                         Library, filters, jobs, downloads and authentication UI
    ├── appearance.css                 Optical layers and tabbed appearance panel styling
    ├── appearance.js                  Appearance controls, settings migration and presets
    ├── engine-sort.js                 Library engine range and sorting integration
    ├── fab.jpeg                       FabGUI branding artwork
    ├── index.html                     App shell, dialogs, appearance panel and line artwork
    ├── install-app.js                 Browser installation prompt control
    ├── manifest.json                  PWA identity, launch scope, display mode and icons
    ├── service-worker.js              Network-only PWA navigation and backend error response
    ├── style.css                      Shared UI styling
    ├── backgrounds/
    │   ├── Gold-Gate-wallpaper-dark.png Bundled dark wallpaper
    │   ├── Gold-Gate-wallpaper.png      Bundled light wallpaper
    │   └── zelda40th.jpg                Bundled 40th Anniversary wallpaper
    ├── icons/
    │   ├── fabgui-192.png               192 px application icon
    │   ├── fabgui-512.png               512 px application icon
    │   ├── fabgui-maskable-512.png      512 px maskable application icon
    │   └── fabgui.svg                  Translucent graphite FabGUI icon source
    └── liquidGL/
        ├── LICENSE                     LiquidGL's MIT license
        ├── fabgui-glass.js              Shared WebGL 2 shaders and optical passes
        └── glass-scene.js               Viewport geometry, backdrop, video and invalidation
```

The installed service reads `server.py`, `static/`, `settings.json`, and the
optional `user-video.mp4` from `~/.local/share/fabgui`.
