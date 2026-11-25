const STORAGE_KEY = "fabgui.appearance.v1";
const DEFAULTS = {
  wallpaperEnabled: true,
  wallpaperKind: "lines",   // "lines" | "video" | "dark-bg" | "light-bg"
  tint: 24,
  glassFrost: 0,            // global frosted glass blur applied to all glass elements (px)
  refractionIndex: 1.00,    // IOR (index of refraction)
  refractionStrength: 0.30, // how much refraction is applied (30%)
  dim: 24,
  videoSrc: "",
};
const GREY_TINT = [56, 56, 56];
let glassLens = null;
let settings = { ...DEFAULTS };
let videoBg = null;
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
      wallpaperKind: stored.wallpaperKind || DEFAULTS.wallpaperKind,
      tint: clamp(stored.tint, 0, 75, DEFAULTS.tint),
      glassFrost: clamp(stored.glassFrost, 0, 8, DEFAULTS.glassFrost),
      refractionIndex: clamp(stored.refractionIndex, 1.0, 2.5, DEFAULTS.refractionIndex),
      refractionStrength: clamp(stored.refractionStrength, 0, 1, DEFAULTS.refractionStrength),
      dim: clamp(stored.dim, 0, 70, DEFAULTS.dim),
      videoSrc: stored.videoSrc || "",
    };
  } catch (error) { settings = { ...DEFAULTS }; }
}
function saveSettings() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (error) {} }
function tintValue() { return `rgba(${GREY_TINT.join(", ")}, ${(settings.tint / 100).toFixed(2)})`; }
function updateBackground() {
  const enabled = settings.wallpaperEnabled && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.toggle("background-motion-off", !enabled);
  document.documentElement.style.setProperty("--wallpaper-dim", (settings.dim / 100).toFixed(2));
  document.documentElement.style.setProperty("--line-opacity", enabled ? "0.7" : "0.3");
  document.documentElement.style.setProperty("--line-speed", enabled ? "24s" : "0s");
  document.documentElement.style.setProperty("--glass-frost", settings.glassFrost + "px");
  const body = document.body;
  if (settings.wallpaperKind === "dark-bg") {
    body.classList.add("has-dark-bg");
    body.classList.remove("has-light-bg", "has-video-bg");
    body.style.setProperty("--bg-image", "url('/static/backgrounds/Gold-Gate-wallpaper-dark.png')");
  } else if (settings.wallpaperKind === "light-bg") {
    body.classList.add("has-light-bg");
    body.classList.remove("has-dark-bg", "has-video-bg");
    body.style.setProperty("--bg-image", "url('/static/backgrounds/Gold-Gate-wallpaper.png')");
  } else {
    body.classList.remove("has-dark-bg", "has-light-bg", "has-video-bg");
    body.style.removeProperty("--bg-image");
  }
  if (settings.wallpaperKind === "video" && settings.videoSrc && videoBg) {
    body.classList.add("has-video-bg");
    videoBg.src = settings.videoSrc;
    videoBg.style.display = "block";
    try { videoBg.play().catch(() => {}); } catch (e) {}
  } else if (videoBg) {
    videoBg.style.display = "none";
  }
  document.documentElement.classList.toggle("lines-bg", settings.wallpaperKind !== "video");
}
function renderSettings() {
  $("#wallpaperEnabled").checked = settings.wallpaperEnabled;
  $("#glassTint").value = settings.tint;
  $("#glassTintValue").value = `${settings.tint}%`;
  $("#glassFrost").value = settings.glassFrost;
  $("#glassFrostValue").value = settings.glassFrost.toFixed(1);
  $("#glassIndex").value = settings.refractionIndex;
  $("#glassIndexValue").value = settings.refractionIndex.toFixed(2);
  $("#glassStrength").value = settings.refractionStrength;
  $("#glassStrengthValue").value = (settings.refractionStrength * 100).toFixed(0) + "%";
  $("#wallpaperDim").value = settings.dim;
  $("#wallpaperDimValue").value = `${settings.dim}%`;
  document.querySelectorAll('input[name="wallpaperKind"]').forEach((el) => {
    el.checked = el.value === settings.wallpaperKind;
  });
  $("#videoFile").value = "";
  if (glassLens) {
    try {
      glassLens.setTint(tintValue());
      if (glassLens.options) {
        glassLens.options.frost = 0;
        glassLens.options.bevelDepth = settings.refractionIndex - 1.0;
        glassLens.options.refraction = settings.refractionStrength * 0.5;
      }
    }
    catch (error) { console.warn("Could not update liquid glass settings", error); }
  }
  updateBackground(); saveSettings();
}
function destroyGlass() {
  if (glassLens) {
    try { glassLens.destroy(); } catch (error) {}
    glassLens = null;
  }
}
function initializeGlass() {
  destroyGlass();
  if (!window.liquidGLFactory) return;
  try {
    glassLens = window.liquidGLFactory({
      engine: "auto", snapshot: "body", target: "body", content: false,
      resolution: 1.25, zIndex: 1, refraction: settings.refractionStrength * 0.5, aberration: 0,
      bevelDepth: settings.refractionIndex - 1.0, bevelWidth: 0.211, frost: 0,
      shadow: true, specular: true, reveal: "fade", tilt: false,
      draggable: false, magnify: 1, tint: tintValue(), helper: false,
    });
  } catch (error) { console.warn("Liquid glass unavailable; keeping the CSS glass fallback", error); }
}
function bindSettings() {
  $("#wallpaperEnabled").addEventListener("change", (event) => { settings.wallpaperEnabled = event.target.checked; renderSettings(); });
  document.querySelectorAll('input[name="wallpaperKind"]').forEach((el) => {
    el.addEventListener("change", (event) => { settings.wallpaperKind = event.target.value; renderSettings(); });
  });
  $("#glassTint").addEventListener("input", (event) => { settings.tint = clamp(event.target.value, 0, 75, DEFAULTS.tint); renderSettings(); });
  $("#glassFrost").addEventListener("input", (event) => {
    settings.glassFrost = clamp(event.target.value, 0, 8, DEFAULTS.glassFrost);
    renderSettings();
  });
  $("#glassIndex").addEventListener("input", (event) => {
    settings.refractionIndex = clamp(event.target.value, 1.0, 2.5, DEFAULTS.refractionIndex);
    renderSettings();
    initializeGlass();
  });
  $("#glassStrength").addEventListener("input", (event) => {
    settings.refractionStrength = clamp(event.target.value, 0, 1, DEFAULTS.refractionStrength);
    renderSettings();
    initializeGlass();
  });
  $("#wallpaperDim").addEventListener("input", (event) => { settings.dim = clamp(event.target.value, 0, 70, DEFAULTS.dim); renderSettings(); });
  $("#videoFile").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    settings.videoSrc = url;
    settings.wallpaperKind = "video";
    renderSettings();
  });
  $("#resetAppearance").addEventListener("click", () => {
    settings = { ...DEFAULTS };
    renderSettings();
    initializeGlass();
    $("#wallpaperStatus").textContent = "Slow flowing glass lines";
  });
  document.addEventListener("click", (event) => { const menu = $("#appearanceMenu"); if (menu.open && !menu.contains(event.target)) menu.open = false; });
}
async function bootAppearance() {
  loadSettings(); bindSettings(); renderSettings();
  videoBg = document.createElement("video");
  videoBg.id = "videoWallpaper";
  videoBg.muted = true;
  videoBg.loop = true;
  videoBg.playsInline = true;
  videoBg.autoplay = true;
  videoBg.style.display = "none";
  videoBg.style.position = "fixed";
  videoBg.style.inset = "0";
  videoBg.style.width = "100vw";
  videoBg.style.height = "100vh";
  videoBg.style.objectFit = "cover";
  videoBg.style.zIndex = "-3";
  videoBg.style.pointerEvents = "none";
  document.body.appendChild(videoBg);
  try {
    const { default: liquidGL } = await import("https://cdn.jsdelivr.net/npm/liquid-gl@3.0.0/liquidGL.js");
    window.liquidGLFactory = liquidGL; initializeGlass();
  } catch (error) {
    console.warn("Could not load liquidGL; using the built-in CSS glass fallback", error);
    $("#wallpaperStatus").textContent = "Liquid glass shader unavailable; using the CSS glass fallback.";
  }
}
document.addEventListener("DOMContentLoaded", bootAppearance, { once: true });
