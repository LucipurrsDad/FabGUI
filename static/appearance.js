const STORAGE_KEY = "fabgui.appearance.v1";
const DB_NAME = "fabgui-wallpaper";
const DB_STORE = "media";
const DEFAULTS = { wallpaperEnabled: true, tint: 36, frost: 2, dim: 24 };
const GREY_TINT = [56, 56, 56];
let glassLens = null;
let wallpaperObjectUrl = null;
let settings = { ...DEFAULTS };

const $ = (selector) => document.querySelector(selector);

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    settings = {
      wallpaperEnabled: stored.wallpaperEnabled !== false,
      tint: clamp(stored.tint, 0, 75, DEFAULTS.tint),
      frost: clamp(stored.frost, 0, 8, DEFAULTS.frost),
      dim: clamp(stored.dim, 0, 70, DEFAULTS.dim),
    };
  } catch (error) {
    settings = { ...DEFAULTS };
  }
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (error) {}
}

function tintValue() {
  return `rgba(${GREY_TINT.join(", ")}, ${(settings.tint / 100).toFixed(2)})`;
}

function openWallpaperDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("Browser storage is unavailable"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open wallpaper storage"));
  });
}

async function storeWallpaper(file) {
  const db = await openWallpaperDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, "readwrite");
    transaction.objectStore(DB_STORE).put({ blob: file, name: file.name, type: file.type }, "selected");
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = transaction.onabort = () => {
      db.close(); reject(transaction.error || new Error("Not enough browser storage for this video"));
    };
  });
}

async function readWallpaper() {
  const db = await openWallpaperDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get("selected");
    request.onsuccess = () => { db.close(); resolve(request.result || null); };
    request.onerror = () => { db.close(); reject(request.error || new Error("Could not read saved wallpaper")); };
  });
}

async function deleteWallpaper() {
  const db = await openWallpaperDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, "readwrite");
    transaction.objectStore(DB_STORE).delete("selected");
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = transaction.onabort = () => {
      db.close(); reject(transaction.error || new Error("Could not clear wallpaper"));
    };
  });
}

function setWallpaper(blob, name = "Selected video") {
  const video = $("#backgroundVideo");
  if (wallpaperObjectUrl) URL.revokeObjectURL(wallpaperObjectUrl);
  wallpaperObjectUrl = URL.createObjectURL(blob);
  video.src = wallpaperObjectUrl;
  video.hidden = false;
  video.load();
  if (settings.wallpaperEnabled && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    video.play().catch(() => setWallpaperStatus("Wallpaper is selected; press play in the browser if autoplay is blocked."));
  }
  setWallpaperStatus(`${name} · saved in this browser`);
  initializeGlassWhenReady();
}

function setWallpaperStatus(message) {
  const status = $("#wallpaperStatus");
  if (status) status.textContent = message;
}

function updateWallpaperPlayback() {
  const video = $("#backgroundVideo");
  video.hidden = !settings.wallpaperEnabled;
  if (!settings.wallpaperEnabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    video.pause();
  } else if (video.src) {
    video.play().catch(() => {});
  }
}

function renderSettings() {
  $("#wallpaperEnabled").checked = settings.wallpaperEnabled;
  $("#glassTint").value = settings.tint;
  $("#glassTintValue").value = `${settings.tint}%`;
  $("#glassFrost").value = settings.frost;
  $("#glassFrostValue").value = String(settings.frost);
  $("#wallpaperDim").value = settings.dim;
  $("#wallpaperDimValue").value = `${settings.dim}%`;
  document.documentElement.style.setProperty("--wallpaper-dim", (settings.dim / 100).toFixed(2));
  if (glassLens) {
    try {
      glassLens.setTint(tintValue());
      if (glassLens.options) glassLens.options.frost = settings.frost;
    } catch (error) { console.warn("Could not update liquid glass settings", error); }
  }
  updateWallpaperPlayback();
  saveSettings();
}

async function initializeGlassWhenReady() {
  if (glassLens || !window.liquidGLFactory) return;
  const video = $("#backgroundVideo");
  if (!video.src || video.readyState < 2) {
    if (video.src) video.addEventListener("loadeddata", initializeGlassWhenReady, { once: true });
    else initializeGlassNow();
    return;
  }
  initializeGlassNow();
}

function initializeGlassNow() {
  if (glassLens || !window.liquidGLFactory) return;
  try {
    glassLens = window.liquidGLFactory({
      engine: "auto",
      snapshot: "body",
      target: "#libraryPanel",
      content: false,
      resolution: 1.25,
      zIndex: 1,
      refraction: 0,
      aberration: 0,
      bevelDepth: 0.052,
      bevelWidth: 0.211,
      frost: settings.frost,
      shadow: true,
      specular: true,
      reveal: "fade",
      tilt: false,
      draggable: false,
      magnify: 1,
      tint: tintValue(),
      helper: false,
    });
  } catch (error) {
    console.warn("Liquid glass unavailable; keeping the CSS glass fallback", error);
  }
}

function bindSettings() {
  $("#wallpaperEnabled").addEventListener("change", (event) => {
    settings.wallpaperEnabled = event.target.checked;
    renderSettings();
  });
  $("#glassTint").addEventListener("input", (event) => {
    settings.tint = clamp(event.target.value, 0, 75, DEFAULTS.tint);
    renderSettings();
  });
  $("#glassFrost").addEventListener("input", (event) => {
    settings.frost = clamp(event.target.value, 0, 8, DEFAULTS.frost);
    renderSettings();
  });
  $("#wallpaperDim").addEventListener("input", (event) => {
    settings.dim = clamp(event.target.value, 0, 70, DEFAULTS.dim);
    renderSettings();
  });
  $("#wallpaperFile").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setWallpaperStatus("Please choose a video file.");
      event.target.value = "";
      return;
    }
    setWallpaper(file, file.name);
    try {
      await storeWallpaper(file);
      setWallpaperStatus(`${file.name} · saved in this browser`);
    } catch (error) {
      setWallpaperStatus(`${file.name} · active for this tab, but could not persist (${error.message})`);
    }
  });
  $("#resetAppearance").addEventListener("click", async () => {
    settings = { ...DEFAULTS };
    renderSettings();
    try {
      await deleteWallpaper();
      setWallpaperStatus("Appearance reset. Choose a video to use as your wallpaper.");
    } catch (error) {
      setWallpaperStatus("Appearance reset; saved video could not be cleared.");
    }
    if (wallpaperObjectUrl) URL.revokeObjectURL(wallpaperObjectUrl);
    wallpaperObjectUrl = null;
    const video = $("#backgroundVideo");
    video.pause(); video.removeAttribute("src"); video.load();
    video.hidden = false;
    initializeGlassWhenReady();
  });
  document.addEventListener("click", (event) => {
    const menu = $("#appearanceMenu");
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
}

async function bootAppearance() {
  loadSettings();
  bindSettings();
  renderSettings();
  const video = $("#backgroundVideo");
  video.addEventListener("error", () => setWallpaperStatus("Could not play this video format. Try a browser-compatible MP4/WebM video."));
  try {
    const savedWallpaper = await readWallpaper();
    if (savedWallpaper && savedWallpaper.blob) setWallpaper(savedWallpaper.blob, savedWallpaper.name);
    else initializeGlassWhenReady();
  } catch (error) {
    setWallpaperStatus("Choose a video to use as your wallpaper.");
    initializeGlassWhenReady();
  }
  try {
    const { default: liquidGL } = await import("https://cdn.jsdelivr.net/npm/liquid-gl@3.0.0/liquidGL.js");
    window.liquidGLFactory = liquidGL;
    initializeGlassWhenReady();
  } catch (error) {
    console.warn("Could not load liquidGL; using the built-in CSS glass styling", error);
    setWallpaperStatus("Liquid glass shader unavailable; using the CSS glass fallback. Wallpaper settings still work.");
  }
}

document.addEventListener("DOMContentLoaded", bootAppearance, { once: true });
