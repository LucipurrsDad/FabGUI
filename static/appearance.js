const STORAGE_KEY = "fabgui.appearance.v1";
const DEFAULTS = { wallpaperEnabled: true, tint: 36, frost: 2, dim: 24 };
const GREY_TINT = [56, 56, 56];
let glassLens = null;
let settings = { ...DEFAULTS };
const $ = (selector) => document.querySelector(selector);
function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    settings = {
      wallpaperEnabled: stored.wallpaperEnabled !== false,
      tint: clamp(stored.tint, 0, 75, DEFAULTS.tint),
      frost: clamp(stored.frost, 0, 8, DEFAULTS.frost),
      dim: clamp(stored.dim, 0, 70, DEFAULTS.dim),
    };
  } catch (error) { settings = { ...DEFAULTS }; }
}
function saveSettings() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (error) {} }
function tintValue() { return `rgba(${GREY_TINT.join(", ")}, ${(settings.tint / 100).toFixed(2)})`; }
function updateBackground() {
  const enabled = settings.wallpaperEnabled && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.toggle("background-motion-off", !enabled);
  document.documentElement.style.setProperty("--wallpaper-dim", (settings.dim / 100).toFixed(2));
  document.documentElement.style.setProperty("--line-opacity", enabled ? "0.6" : "0.3");
  document.documentElement.style.setProperty("--line-speed", enabled ? "36s" : "0s");
}
function renderSettings() {
  $("#wallpaperEnabled").checked = settings.wallpaperEnabled;
  $("#glassTint").value = settings.tint;
  $("#glassTintValue").value = `${settings.tint}%`;
  $("#glassFrost").value = settings.frost;
  $("#glassFrostValue").value = String(settings.frost);
  $("#wallpaperDim").value = settings.dim;
  $("#wallpaperDimValue").value = `${settings.dim}%`;
  if (glassLens) {
    try { glassLens.setTint(tintValue()); if (glassLens.options) glassLens.options.frost = settings.frost; }
    catch (error) { console.warn("Could not update liquid glass settings", error); }
  }
  updateBackground(); saveSettings();
}
function initializeGlass() {
  if (glassLens || !window.liquidGLFactory) return;
  try {
    glassLens = window.liquidGLFactory({
      engine: "auto", snapshot: "body", target: "#libraryPanel", content: false,
      resolution: 1.25, zIndex: 1, refraction: 0, aberration: 0,
      bevelDepth: 0.052, bevelWidth: 0.211, frost: settings.frost,
      shadow: true, specular: true, reveal: "fade", tilt: false,
      draggable: false, magnify: 1, tint: tintValue(), helper: false,
    });
  } catch (error) { console.warn("Liquid glass unavailable; keeping the CSS glass fallback", error); }
}
function bindSettings() {
  $("#wallpaperEnabled").addEventListener("change", (event) => { settings.wallpaperEnabled = event.target.checked; renderSettings(); });
  $("#glassTint").addEventListener("input", (event) => { settings.tint = clamp(event.target.value, 0, 75, DEFAULTS.tint); renderSettings(); });
  $("#glassFrost").addEventListener("input", (event) => { settings.frost = clamp(event.target.value, 0, 8, DEFAULTS.frost); renderSettings(); });
  $("#wallpaperDim").addEventListener("input", (event) => { settings.dim = clamp(event.target.value, 0, 70, DEFAULTS.dim); renderSettings(); });
  $("#resetAppearance").addEventListener("click", () => { settings = { ...DEFAULTS }; renderSettings(); $("#wallpaperStatus").textContent = "Slow flowing glass lines"; });
  document.addEventListener("click", (event) => { const menu = $("#appearanceMenu"); if (menu.open && !menu.contains(event.target)) menu.open = false; });
}
async function bootAppearance() {
  loadSettings(); bindSettings(); renderSettings();
  try {
    const { default: liquidGL } = await import("https://cdn.jsdelivr.net/npm/liquid-gl@3.0.0/liquidGL.js");
    window.liquidGLFactory = liquidGL; initializeGlass();
  } catch (error) {
    console.warn("Could not load liquidGL; using the built-in CSS glass styling", error);
    $("#wallpaperStatus").textContent = "Liquid glass shader unavailable; using the CSS glass fallback.";
  }
}
document.addEventListener("DOMContentLoaded", bootAppearance, { once: true });
