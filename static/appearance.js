/* FabGUI appearance + liquid glass.
 *
 * The glass is applied to individual surfaces (header and asset cards) rather
 * than to <body>. Targeting <body> makes liquidGL set pointer-events: none and
 * strip the page background, which is what broke buttons, wallpapers and video
 * in the previous implementation. Header and cards keep their own content above
 * the shared lens canvas, so every control stays clickable.
 */
const STORAGE_KEY = "fabgui.appearance.v3";
const DEFAULTS = {
  wallpaperEnabled: true,
  wallpaperKind: "lines",   // "lines" | "video" | "dark-bg" | "light-bg"
  tint: 24,
  glassFrost: 0,            // global frost in px, applied to every glass surface
  refractionIndex: 1.50,    // 1.0 = flat, 2.5 = strong edge bend
  refractionStrength: 0.65, // 0 = flat, 1 = strongest refraction
  bevelWidth: 0.18,         // edge band as a fraction of the shortest side
  dim: 24,
  videoSrc: "",
};
const GREY_TINT = [56, 56, 56];
const WALLPAPERS = {
  "dark-bg": "/static/backgrounds/Gold-Gate-wallpaper-dark.png",
  "light-bg": "/static/backgrounds/Gold-Gate-wallpaper.png",
};
const MAX_CARD_LENSES = 32;
const CARD_ROOT_MARGIN = "320px";

let settings = { ...DEFAULTS };
let videoBg = null;
let glassReady = false;
let glassId = 0;
let cardObserver = null;
let bodyRenderer = null;
let snapshotTimer = null;
const allLenses = new Set();
const cardLenses = new Map();

const $ = (selector) => document.querySelector(selector);

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function loadSettings() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {}; } catch (error) { stored = {}; }

  // The previous key used a much weaker refraction mapping. Carry only the
  // background choice over so the new glass starts with the new defaults.
  if (!Object.keys(stored).length) {
    try {
      const legacy = JSON.parse(localStorage.getItem("fabgui.appearance.v2") || "{}");
      stored = {
        wallpaperEnabled: legacy.wallpaperEnabled,
        wallpaperKind: legacy.wallpaperKind,
        dim: legacy.dim,
        videoSrc: legacy.videoSrc,
      };
    } catch (error) { stored = {}; }
  }

  const kind = ["lines", "video", "dark-bg", "light-bg"].includes(stored.wallpaperKind)
    ? stored.wallpaperKind : DEFAULTS.wallpaperKind;
  settings = {
    wallpaperEnabled: stored.wallpaperEnabled !== false,
    wallpaperKind: kind,
    tint: clamp(stored.tint, 0, 75, DEFAULTS.tint),
    glassFrost: clamp(stored.glassFrost, 0, 8, DEFAULTS.glassFrost),
    refractionIndex: clamp(stored.refractionIndex, 1.0, 2.5, DEFAULTS.refractionIndex),
    refractionStrength: clamp(stored.refractionStrength, 0, 1, DEFAULTS.refractionStrength),
    bevelWidth: clamp(stored.bevelWidth, 0.05, 0.4, DEFAULTS.bevelWidth),
    dim: clamp(stored.dim, 0, 70, DEFAULTS.dim),
    videoSrc: typeof stored.videoSrc === "string" ? stored.videoSrc : "",
  };
  if (settings.wallpaperKind === "video" && !settings.videoSrc) settings.wallpaperKind = "lines";
}

function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (error) {}
}

function tintValue() {
  return `rgba(${GREY_TINT.join(", ")}, ${(settings.tint / 100).toFixed(3)})`;
}

function tintArray() {
  return [GREY_TINT[0] / 255, GREY_TINT[1] / 255, GREY_TINT[2] / 255, settings.tint / 100];
}

/* liquidGL's offsets are fractions of the backdrop texture. These values are
   deliberately stronger than the library defaults because the lenses here are
   cards and a header, not a full-screen pane; the old 0.024 offset was too
   subtle to read as refraction on a low-contrast line background. */
function lensPhysics() {
  const strength = settings.refractionStrength;
  const bend = Math.max(0, settings.refractionIndex - 1);
  return {
    refraction: strength * (0.06 + bend * 0.05),
    bevelDepth: strength * (0.04 + bend * 0.12),
    // The shader turns frost into blur(frost * 4px). Dividing here makes the
    // global frost slider mean the same number of pixels as the CSS fallback.
    frost: settings.glassFrost / 4,
  };
}

function updateStatus() {
  const status = $("#wallpaperStatus");
  if (!status) return;
  if (settings.wallpaperKind === "video") {
    status.textContent = settings.videoSrc ? "Video background" : "Choose a video to use as the background";
  } else if (settings.wallpaperKind === "dark-bg") {
    status.textContent = "Dark Gold-Gate wallpaper";
  } else if (settings.wallpaperKind === "light-bg") {
    status.textContent = "Light Gold-Gate wallpaper";
  } else {
    status.textContent = settings.wallpaperEnabled ? "Slow flowing glass lines" : "Glass lines paused";
  }
}

function updateVideo() {
  if (!videoBg) return;
  const useVideo = settings.wallpaperKind === "video" && Boolean(settings.videoSrc);
  if (!useVideo) {
    videoBg.style.display = "none";
    try { videoBg.pause(); } catch (error) {}
    return;
  }

  videoBg.style.display = "block";
  if (videoBg.dataset.src !== settings.videoSrc) {
    videoBg.dataset.src = settings.videoSrc;
    videoBg.src = settings.videoSrc;
    videoBg.load();
  }
  const play = () => {
    videoBg.muted = true;
    const attempt = videoBg.play();
    if (attempt && typeof attempt.catch === "function") attempt.catch(() => {});
  };
  if (videoBg.readyState >= 2) play();
  else videoBg.addEventListener("canplay", play, { once: true });
}

function updateBackground() {
  const motion = settings.wallpaperEnabled && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  const body = document.body;
  const stage = $(".background-stage");

  root.classList.toggle("background-motion-off", !motion);
  root.classList.toggle("no-liquid-glass", !glassReady);
  root.style.setProperty("--wallpaper-dim", (settings.dim / 100).toFixed(2));
  root.style.setProperty("--glass-frost", `${settings.glassFrost}px`);
  root.style.setProperty("--glass-tint-alpha", (settings.tint / 100).toFixed(3));
  root.style.setProperty("--line-opacity", motion ? "0.88" : "0.5");
  root.style.setProperty("--line-speed", motion ? "24s" : "0s");

  const kind = settings.wallpaperKind;
  body.classList.toggle("lines-bg", kind === "lines" || (kind === "video" && !settings.videoSrc));
  body.classList.toggle("has-dark-bg", kind === "dark-bg");
  body.classList.toggle("has-light-bg", kind === "light-bg");
  body.classList.toggle("has-video-bg", kind === "video" && Boolean(settings.videoSrc));

  // The wallpaper lives on the fixed stage, not <body>, so liquidGL can
  // capture it. Capturing <body> previously pulled in every card and produced
  // a 37,000px-tall texture that lost the WebGL context.
  if (stage) {
    stage.style.backgroundImage = WALLPAPERS[kind] ? `url('${WALLPAPERS[kind]}')` : "";
  }
  body.style.removeProperty("--bg-image");

  updateVideo();
  updateStatus();
  refreshSnapshots();
}

function refreshSnapshots(delay = 220) {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    const renderers = new Set();
    for (const lens of allLenses) {
      if (lens && !lens._destroyed && lens.renderer) renderers.add(lens.renderer);
    }
    for (const renderer of renderers) {
      try { renderer.captureSnapshot(); } catch (error) {}
    }
  }, delay);
}

function lensOptions(header = false) {
  const headerElement = document.querySelector("header.top");
  const headerZ = headerElement ? parseInt(getComputedStyle(headerElement).zIndex, 10) || 0 : 0;
  return {
    engine: "auto",
    // The page can be tens of thousands of pixels tall (604 cards). Capturing
    // <body> would upload a giant texture and lose the WebGL context, so the
    // glass refracts only the fixed background layer behind the interface.
    snapshot: ".background-stage",
    target: "body", // replaced per call
    resolution: 1.5,
    // For an element that is its own liquidGL anchor (the sticky header), the
    // lens z-index is relative to that element. Matching its computed z-index
    // puts the glass canvas just behind its content instead of far behind the
    // page (-200), which previously produced a lost WebGL context.
    zIndex: header ? headerZ : 50,
    content: false,
    refraction: lensPhysics().refraction,
    aberration: 0,
    bevelDepth: lensPhysics().bevelDepth,
    bevelWidth: settings.bevelWidth,
    frost: lensPhysics().frost,
    shadow: true,
    specular: true,
    reveal: "none",
    tilt: false,
    draggable: false,
    interaction: "none",
    magnify: 1,
    tint: tintValue(),
    helper: false,
  };
}

function applyLensOptions(lens) {
  if (!lens || lens._destroyed || !lens.options) return;
  const physics = lensPhysics();
  lens.options.refraction = physics.refraction;
  lens.options.bevelDepth = physics.bevelDepth;
  lens.options.bevelWidth = settings.bevelWidth;
  lens.options.frost = physics.frost;
  try { lens.setTint(tintValue()); } catch (error) {}
}

function updateLensOptions() {
  for (const lens of allLenses) {
    if (!lens || lens._destroyed) { allLenses.delete(lens); continue; }
    applyLensOptions(lens);
  }
}

function createLens(target, header = false) {
  if (!glassReady || typeof window.liquidGL !== "function") return null;
  try {
    const lens = window.liquidGL({ ...lensOptions(header), target });
    if (Array.isArray(lens)) lens.forEach((item) => allLenses.add(item));
    else if (lens) allLenses.add(lens);
    return lens;
  } catch (error) {
    console.warn("FabGUI: liquid glass could not initialise", target, error);
    return null;
  }
}

function internalOptions(header = false) {
  const options = lensOptions(header);
  // Public liquidGL() parses colour strings; renderer.addLens() expects the
  // already-normalised [r, g, b, a] array.
  options.tint = tintArray();
  return options;
}

function initHeaderGlass() {
  const header = $("header.top");
  if (!header || header.dataset.fabguiGlass) return;
  header.dataset.fabguiGlass = "header";
  createLens("header.top", true);
}

function initToolbarGlass() {
  const tools = $(".library-tools");
  if (!tools || tools.dataset.fabguiGlass) return;
  tools.dataset.fabguiGlass = "toolbar";
  // Both the filter bar and the downloads box share the body-level lens canvas
  // with the cards, so all three use the same refraction and frost settings.
  const lens = createLens(".library-tools", false);
  const first = Array.isArray(lens) ? lens[0] : lens;
  if (first && first.renderer) bodyRenderer = first.renderer;
}

function removeCardLens(card) {
  const lens = cardLenses.get(card);
  if (lens) {
    try { lens.destroy(); } catch (error) {}
    allLenses.delete(lens);
    cardLenses.delete(card);
  }
  if (cardObserver) cardObserver.unobserve(card);
}

function addCardLens(card) {
  if (!glassReady || !card.isConnected || cardLenses.has(card)) return;
  if (cardLenses.size >= MAX_CARD_LENSES) return;
  if (!card.dataset.fabguiGlassId) card.dataset.fabguiGlassId = `card-${++glassId}`;

  // Every public liquidGL() call creates a throwaway WebGL probe context.
  // Calling it once per card exhausted Chrome's context budget after a short
  // scroll, which is why the glass stopped refracting. Reuse the renderer that
  // already owns the body canvas instead.
  let lens = null;
  if (bodyRenderer && !bodyRenderer._destroyed) {
    try {
      lens = bodyRenderer.addLens(card, internalOptions(false));
      allLenses.add(lens);
    } catch (error) {
      lens = null;
    }
  }
  if (!lens) lens = createLens(`[data-fabgui-glass-id="${card.dataset.fabguiGlassId}"]`, false);
  if (lens) cardLenses.set(card, Array.isArray(lens) ? lens[0] : lens);
}

function scanCards() {
  if (!cardObserver) return;
  for (const [card] of cardLenses) {
    if (!card.isConnected) {
      removeCardLens(card);
    }
  }
  document.querySelectorAll("#resultsGrid .asset-card").forEach((card) => {
    if (!card.dataset.fabguiGlassId) card.dataset.fabguiGlassId = `card-${++glassId}`;
    if (!cardLenses.has(card)) cardObserver.observe(card);
  });
}

function setupCardGlass() {
  if (!glassReady || typeof IntersectionObserver === "undefined") return;
  cardObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) addCardLens(entry.target);
      else removeCardLens(entry.target);
    });
  }, { rootMargin: CARD_ROOT_MARGIN, threshold: 0.01 });

  scanCards();
  window.addEventListener("fabgui:results-rendered", scanCards);
  const grid = $("#resultsGrid");
  if (grid) {
    new MutationObserver(scanCards).observe(grid, { childList: true });
  }
}

function renderSettings() {
  const controls = {
    wallpaperEnabled: $("#wallpaperEnabled"),
    glassTint: $("#glassTint"),
    glassFrost: $("#glassFrost"),
    glassIndex: $("#glassIndex"),
    glassStrength: $("#glassStrength"),
    glassBevel: $("#glassBevel"),
    wallpaperDim: $("#wallpaperDim"),
  };
  if (controls.wallpaperEnabled) controls.wallpaperEnabled.checked = settings.wallpaperEnabled;
  if (controls.glassTint) controls.glassTint.value = settings.tint;
  if ($("#glassTintValue")) $("#glassTintValue").value = `${settings.tint}%`;
  if (controls.glassFrost) controls.glassFrost.value = settings.glassFrost;
  if ($("#glassFrostValue")) $("#glassFrostValue").value = settings.glassFrost.toFixed(1);
  if (controls.glassIndex) controls.glassIndex.value = settings.refractionIndex;
  if ($("#glassIndexValue")) $("#glassIndexValue").value = settings.refractionIndex.toFixed(2);
  if (controls.glassStrength) controls.glassStrength.value = settings.refractionStrength;
  if ($("#glassStrengthValue")) $("#glassStrengthValue").value = `${(settings.refractionStrength * 100).toFixed(0)}%`;
  if (controls.glassBevel) controls.glassBevel.value = settings.bevelWidth;
  if ($("#glassBevelValue")) $("#glassBevelValue").value = `${(settings.bevelWidth * 100).toFixed(0)}%`;
  if (controls.wallpaperDim) controls.wallpaperDim.value = settings.dim;
  if ($("#wallpaperDimValue")) $("#wallpaperDimValue").value = `${settings.dim}%`;
  document.querySelectorAll('input[name="wallpaperKind"]').forEach((element) => {
    element.checked = element.value === settings.wallpaperKind;
  });
  const videoInput = $("#videoFile");
  if (videoInput) videoInput.value = "";
  updateBackground();
  updateLensOptions();
  saveSettings();
}

function setVideoStatus(message) {
  const status = $("#wallpaperStatus");
  if (status) status.textContent = message;
}

async function uploadVideo(file) {
  if (!file) return;
  setVideoStatus(`Converting ${file.name} with ffmpeg…`);
  try {
    const response = await fetch("/api/backgrounds/video", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name || "background-video"),
      },
      body: file,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.message || "Video conversion failed");
    settings.videoSrc = result.url;
    settings.wallpaperKind = "video";
    renderSettings();
    setVideoStatus("Video background ready");
    if (typeof window.toast === "function") window.toast("Video background ready", "success");
  } catch (error) {
    setVideoStatus(`Video failed: ${error.message}`);
    if (typeof window.toast === "function") window.toast(`Video failed: ${error.message}`, "error");
  }
}

async function removeVideo() {
  try {
    await fetch("/api/backgrounds/video/delete", { method: "POST" });
  } catch (error) {}
  settings.videoSrc = "";
  if (settings.wallpaperKind === "video") settings.wallpaperKind = "lines";
  renderSettings();
  setVideoStatus("Video background removed");
}

function bindSettings() {
  const on = (selector, event, handler) => {
    const element = $(selector);
    if (element) element.addEventListener(event, handler);
  };

  on("#wallpaperEnabled", "change", (event) => {
    settings.wallpaperEnabled = event.target.checked;
    renderSettings();
  });
  document.querySelectorAll('input[name="wallpaperKind"]').forEach((element) => {
    element.addEventListener("change", (event) => {
      settings.wallpaperKind = event.target.value;
      renderSettings();
    });
  });
  on("#glassTint", "input", (event) => {
    settings.tint = clamp(event.target.value, 0, 75, DEFAULTS.tint);
    renderSettings();
  });
  on("#glassFrost", "input", (event) => {
    settings.glassFrost = clamp(event.target.value, 0, 8, DEFAULTS.glassFrost);
    renderSettings();
  });
  on("#glassIndex", "input", (event) => {
    settings.refractionIndex = clamp(event.target.value, 1.0, 2.5, DEFAULTS.refractionIndex);
    renderSettings();
  });
  on("#glassStrength", "input", (event) => {
    settings.refractionStrength = clamp(event.target.value, 0, 1, DEFAULTS.refractionStrength);
    renderSettings();
  });
  on("#glassBevel", "input", (event) => {
    settings.bevelWidth = clamp(event.target.value, 0.05, 0.4, DEFAULTS.bevelWidth);
    renderSettings();
  });
  on("#wallpaperDim", "input", (event) => {
    settings.dim = clamp(event.target.value, 0, 70, DEFAULTS.dim);
    renderSettings();
  });
  on("#videoFile", "change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) uploadVideo(file);
  });
  on("#removeVideo", "click", (event) => {
    event.preventDefault();
    removeVideo();
  });
  on("#resetAppearance", "click", () => {
    settings = { ...DEFAULTS, videoSrc: settings.videoSrc };
    renderSettings();
    setVideoStatus(settings.videoSrc ? "Settings reset. Choose Video to use your saved clip." : "Settings reset");
  });
  document.addEventListener("click", (event) => {
    const menu = $("#appearanceMenu");
    if (menu && menu.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const menu = $("#appearanceMenu");
    if (menu) menu.open = false;
  });
}

function bootAppearance() {
  loadSettings();
  bindSettings();

  videoBg = document.createElement("video");
  videoBg.id = "videoWallpaper";
  videoBg.muted = true;
  videoBg.defaultMuted = true;
  videoBg.loop = true;
  videoBg.playsInline = true;
  videoBg.autoplay = true;
  videoBg.preload = "auto";
  videoBg.setAttribute("muted", "");
  videoBg.setAttribute("playsinline", "");
  videoBg.setAttribute("aria-hidden", "true");
  videoBg.style.display = "none";
  videoBg.addEventListener("error", () => {
    setVideoStatus("Saved video could not be played. Upload it again.");
  });
  const stage = document.querySelector(".background-stage");
  (stage || document.body).appendChild(videoBg);

  glassReady = typeof window.liquidGL === "function";
  if (!glassReady) {
    console.warn("FabGUI: liquidGL not loaded; using the CSS glass fallback");
    document.documentElement.classList.add("no-liquid-glass");
  }

  renderSettings();
  if (glassReady) {
    initHeaderGlass();
    initToolbarGlass();
    setupCardGlass();
  }
}

document.addEventListener("DOMContentLoaded", bootAppearance, { once: true });
