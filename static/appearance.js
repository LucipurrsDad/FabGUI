import { createGlassScene } from "./liquidGL/glass-scene.js";

const STORAGE_KEY = "fabgui.appearance.v4";
const WALLPAPERS = {
  "dark-bg": ["backgrounds/Gold-Gate-wallpaper-dark.png", "Dark Gold-Gate wallpaper"],
  "light-bg": ["backgrounds/Gold-Gate-wallpaper.png", "Light Gold-Gate wallpaper"],
  anniversary: ["backgrounds/zelda40th.jpg", "40th Anniversary"],
};
const percent = (value) => `${Math.round(value * 100)}%`;
const pixels = (value) => `${value.toFixed(1)} px`;
const ranges = {
  glassOptics: [
    ["tint", "glassTint", "Glass tint", 0, 75, 1, 24, (value) => `${value}%`],
    ["glassFrost", "glassFrost", "Glass frost", 0, 8, .1, 6, pixels],
    ["refractionIndex", "glassIndex", "Refractive index", 1, 2.5, .01, 1.5, (value) => value.toFixed(2)],
    ["refractionStrength", "glassStrength", "Refraction strength", 0, 1, .01, .65, percent],
    ["thickness", "glassThickness", "Glass thickness", 2, 48, .5, 24, pixels],
    ["bevelWidth", "glassBevel", "Edge bevel width", .05, .4, .01, .18, (value) => pixels(value * 80)],
    ["curvature", "glassCurvature", "Edge curvature", 0, 1, .01, .68, percent],
    ["dispersion", "glassDispersion", "Chromatic dispersion", 0, 1, .01, 0, percent],
    ["specular", "glassSpecular", "Specular highlights", 0, 1, .01, .8, percent],
    ["caustics", "glassCaustics", "Caustic shimmer", 0, 1, .01, 0, percent],
    ["colorBleed", "glassBleed", "Ambient color bleed", 0, 1, .01, 0, percent],
  ],
  backgroundEffects: [
    ["dim", "wallpaperDim", "Background dimming", 0, 70, 1, 24, (value) => `${value}%`],
    ["bloom", "wallpaperBloom", "Background bloom", 0, 1, .01, 0, percent],
    ["aurora", "wallpaperAurora", "Procedural aurora", 0, 1, .01, 0, percent],
    ["particles", "wallpaperParticles", "Atmospheric particles", 0, 1, .01, 0, percent],
    ["grain", "wallpaperGrain", "Film grain", 0, 1, .01, 0, percent],
    ["vignette", "wallpaperVignette", "Vignette", 0, 1, .01, 0, percent],
  ],
  motionEffects: [
    ["parallax", "wallpaperParallax", "Scroll parallax", 0, 1, .01, 0, percent],
  ],
  videoEffects: [
    ["videoSpeed", "videoSpeed", "Video speed", .25, 2, .25, 1, (value) => `${value}×`],
  ],
};
const checks = ["wallpaperEnabled", "effectsMotion", "videoPlay", "videoLoop"];
const defaults = {
  wallpaperKind: "lines", videoSrc: "",
  ...Object.fromEntries(checks.map((key) => [key, true])),
  ...Object.fromEntries(Object.values(ranges).flat().map(([key, , , , , , initial]) => [key, initial])),
};
const presets = [
  ["Clear Glass", { tint: 16, glassFrost: 0, dispersion: .16 }],
  ["Soft Frost", { tint: 31, glassFrost: 7, specular: .55, refractionStrength: .38 }],
  ["Aurora Glow", { tint: 29, dispersion: .35, colorBleed: .45, bloom: .30, aurora: .75, caustics: .25, vignette: .4 }],
];
const $ = (selector) => document.querySelector(selector);
const byId = (id) => document.getElementById(id);
const status = (message) => { byId("wallpaperStatus").textContent = message; };

function normalize(stored = {}) {
  const settings = { ...defaults };
  for (const [key, , , min, max] of Object.values(ranges).flat()) {
    const value = Number(stored[key]);
    if (stored[key] != null && Number.isFinite(value)) settings[key] = Math.min(max, Math.max(min, value));
  }
  for (const key of checks) {
    if (typeof stored[key] === "boolean") settings[key] = stored[key];
  }
  if (["lines", "video", ...Object.keys(WALLPAPERS)].includes(stored.wallpaperKind)) settings.wallpaperKind = stored.wallpaperKind;
  if (typeof stored.videoSrc === "string") settings.videoSrc = stored.videoSrc;
  return settings;
}

function readStorage(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function loadAppearance() {
  const stored = readStorage(STORAGE_KEY);
  const legacy = stored?.current ? null : [3, 2, 1].map((version) => readStorage(`fabgui.appearance.v${version}`))
    .find((value) => value && Object.keys(value).length);
  return {
    current: normalize(stored?.current || legacy),
    saved: stored?.saved ? normalize(stored.saved) : null,
    custom: Array.isArray(stored?.custom) ? stored.custom
      .filter((entry) => entry && typeof entry.name === "string" && entry.settings)
      .map((entry) => ({ name: entry.name, settings: normalize(entry.settings) })) : [],
  };
}

const appearance = loadAppearance();
let storageWarned = false;
let videoBusy = false;
const video = byId("videoWallpaper");
const image = byId("wallpaperImage");
const picker = byId("appearancePresets");
const backdropInputs = document.querySelectorAll('input[name="wallpaperKind"]');
const scene = createGlassScene({
  canvas: byId("glassViewport"), image, video,
  grid: byId("resultsGrid"), paths: document.querySelectorAll("#lineArtwork path"),
  onFailure(error) { console.error("FabGUI liquid glass:", error); },
});
Object.defineProperty(window, "__fabguiGlass", { get: () => scene.stats });

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch (error) {
    if (!storageWarned) {
      console.warn("FabGUI could not save appearance in this browser", error);
      storageWarned = true;
    }
    byId("appearanceFeedback").textContent = "This browser could not save the settings.";
  }
}

function updateVideo() {
  const { wallpaperKind, videoSrc, videoLoop, videoSpeed, videoPlay } = appearance.current;
  if (wallpaperKind !== "video" || !videoSrc || document.hidden) {
    video.pause();
    return;
  }
  if (video.getAttribute("src") !== videoSrc) video.src = videoSrc;
  video.loop = videoLoop;
  if (video.playbackRate !== videoSpeed) video.playbackRate = videoSpeed;
  if (!videoPlay) {
    video.pause();
  } else if (video.paused && !video.ended) {
    video.play().catch((error) => {
      if (error.name !== "AbortError" && appearance.current.wallpaperKind === "video") {
        status("Video playback could not start. Check the saved clip or try Restart video.");
      }
    });
  }
}

function updateWallpaper() {
  const { wallpaperKind, wallpaperEnabled, videoSrc, videoPlay } = appearance.current;
  const wallpaper = WALLPAPERS[wallpaperKind];
  if (wallpaper) {
    const source = new URL(wallpaper[0], import.meta.url).href;
    if (image.src !== source) image.src = source;
  } else if (image.hasAttribute("src")) {
    image.removeAttribute("src");
  }
  if (!videoSrc && video.hasAttribute("src")) {
    video.removeAttribute("src");
    video.load();
  }
  if (!videoBusy) {
    if (wallpaper) status(wallpaper[1]);
    else if (wallpaperKind === "video") {
      status(videoSrc ? (videoPlay ? "Video background selected" : "Video paused") : "Choose a clip to preview it here.");
    }
    else status(wallpaperEnabled ? "Slow flowing glass lines" : "Glass lines paused");
  }
  byId("removeVideo").disabled = videoBusy || !videoSrc;
  byId("restartVideo").disabled = videoBusy || !videoSrc || wallpaperKind !== "video";
  byId("chooseVideo").textContent = videoSrc ? "Replace video…" : "Choose video…";
  byId("videoSettings").hidden = wallpaperKind !== "video";
  byId("videoPlayback").hidden = !videoSrc;
  updateVideo();
}

function renderSettings() {
  const settings = appearance.current;
  for (const [key, id, , , , , , format] of Object.values(ranges).flat()) {
    byId(id).value = settings[key];
    byId(`${id}Value`).value = format(settings[key]);
  }
  for (const key of checks) byId(key).checked = settings[key];
  backdropInputs.forEach((input) => { input.checked = input.value === settings.wallpaperKind; });
  byId("restoreAppearance").disabled = !appearance.saved;
  updateWallpaper();
  scene.update(settings);
  persist();
}

function edit(key, value) {
  appearance.current[key] = value;
  picker.value = "";
  renderSettings();
}

function addRanges() {
  for (const [group, controls] of Object.entries(ranges)) {
    for (const [key, id, label, min, max, step] of controls) {
      const title = document.createElement("label");
      title.className = "appearance-range-label";
      title.htmlFor = id;
      const caption = document.createElement("span");
      caption.textContent = label;
      const value = document.createElement("output");
      value.id = `${id}Value`;
      value.htmlFor = id;
      title.append(caption, value);
      const input = document.createElement("input");
      Object.assign(input, { id, type: "range", min, max, step, className: "appearance-range" });
      input.addEventListener("input", () => edit(key, input.valueAsNumber));
      byId(group).append(title, input);
    }
  }
}

function renderPresets() {
  picker.replaceChildren(new Option("Choose a preset…", ""));
  const included = document.createElement("optgroup");
  included.label = "Built-in presets";
  presets.forEach(([name], index) => included.append(new Option(name, `built-in:${index}`)));
  picker.append(included);
  if (appearance.custom.length) {
    const custom = document.createElement("optgroup");
    custom.label = "Custom presets";
    appearance.custom.forEach(({ name }, index) => custom.append(new Option(name, `custom:${index}`)));
    picker.append(custom);
  }
}

function restoreSettings(settings) {
  appearance.current = { ...settings, videoSrc: appearance.current.videoSrc };
  renderSettings();
}

function setVideoBusy(busy) {
  videoBusy = busy;
  byId("videoFile").disabled = busy;
  byId("chooseVideo").disabled = busy;
  updateWallpaper();
}

async function updateSavedVideo(file) {
  if (videoBusy) return;
  setVideoBusy(true);
  status(file ? `Converting ${file.name} with ffmpeg…` : "Removing background video…");
  let message;
  try {
    const response = await fetch(file ? "/api/backgrounds/video" : "/api/backgrounds/video/delete", {
      method: "POST",
      ...(file && {
        headers: { "Content-Type": file.type || "application/octet-stream", "X-Filename": encodeURIComponent(file.name) },
        body: file,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || "Video update failed");
    if (file) {
      appearance.current.videoSrc = result.url;
      edit("wallpaperKind", "video");
    } else {
      edit("videoSrc", "");
    }
    message = file ? "Video background ready" : "Video background removed";
    window.toast?.(message, "success");
  } catch (error) {
    message = `Video update failed: ${error.message}`;
    window.toast?.(message, "error");
  } finally {
    setVideoBusy(false);
    status(message);
    byId("videoFile").value = "";
  }
}

addRanges();
renderPresets();
for (const key of checks) byId(key).addEventListener("change", (event) => edit(key, event.target.checked));
backdropInputs.forEach((input) => input.addEventListener("change", () => edit("wallpaperKind", input.value)));
byId("chooseVideo").addEventListener("click", () => byId("videoFile").click());
byId("videoFile").addEventListener("change", ({ target }) => {
  if (target.files[0]) updateSavedVideo(target.files[0]);
});
byId("removeVideo").addEventListener("click", () => updateSavedVideo(null));
byId("restartVideo").addEventListener("click", () => {
  if (video.readyState) video.currentTime = 0;
  edit("videoPlay", true);
});
video.addEventListener("error", () => status("Saved video could not be played. Upload it again."));
image.addEventListener("error", () => status("The wallpaper image could not be loaded."));
document.addEventListener("visibilitychange", updateVideo);

const feedback = byId("appearanceFeedback");
picker.addEventListener("change", () => {
  if (!picker.value) return;
  const [type, index] = picker.value.split(":");
  if (type === "custom") {
    restoreSettings(appearance.custom[index].settings);
  } else {
    const visualDefaults = Object.fromEntries([...ranges.glassOptics, ...ranges.backgroundEffects].map(([key]) => [key, defaults[key]]));
    restoreSettings({ ...appearance.current, ...visualDefaults, ...presets[index][1] });
  }
});
byId("saveAppearancePreset").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = byId("appearancePresetName");
  const name = input.value.trim();
  if (!name) {
    feedback.textContent = "Enter a name for your preset.";
    return;
  }
  const settings = { ...appearance.current };
  const existing = appearance.custom.findIndex((preset) => preset.name === name);
  const index = existing < 0 ? appearance.custom.length : existing;
  appearance.custom[index] = { name, settings };
  appearance.saved = settings;
  renderPresets();
  picker.value = `custom:${index}`;
  input.value = "";
  feedback.textContent = `Saved “${name}”.`;
  renderSettings();
});
byId("resetAppearance").addEventListener("click", () => {
  picker.value = "";
  feedback.textContent = "Restored default appearance.";
  restoreSettings(defaults);
});
byId("restoreAppearance").addEventListener("click", () => {
  picker.value = "";
  feedback.textContent = "Restored your last saved appearance.";
  restoreSettings(appearance.saved);
});

const menu = byId("appearanceMenu");
const appearanceTabs = [...menu.querySelectorAll('[role="tab"]')];
function selectAppearanceTab(tab) {
  for (const item of appearanceTabs) {
    const selected = item === tab;
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
    byId(item.getAttribute("aria-controls")).hidden = !selected;
  }
  menu.querySelector(".appearance-scroll").scrollTop = 0;
}
for (const [index, tab] of appearanceTabs.entries()) {
  tab.addEventListener("click", () => selectAppearanceTab(tab));
  tab.addEventListener("keydown", (event) => {
    const next = {
      ArrowLeft: (index + appearanceTabs.length - 1) % appearanceTabs.length,
      ArrowRight: (index + 1) % appearanceTabs.length,
      Home: 0,
      End: appearanceTabs.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectAppearanceTab(appearanceTabs[next]);
    appearanceTabs[next].focus();
  });
}
document.addEventListener("click", (event) => {
  if (menu.open && !menu.contains(event.target)) menu.open = false;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menu.open) {
    menu.open = false;
    menu.querySelector("summary").focus();
  }
});
renderSettings();
