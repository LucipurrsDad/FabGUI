import { LiquidGlass } from "./fabgui-glass.js";

const LINE_COLORS = ["#6e9cc8", "#a484c6", "#68c4ae", "#ca9c76", "#aeaed0", "#76bae4", "#d490b0", "#84d09c"];
const FRAME_INTERVAL = 1000 / 30;

// Retain the original line wallpaper paths and timing. Rasterize only the
// art into a small reusable texture; glass never snapshots the page DOM.
function lineWallpaper(paths) {
  const texture = document.createElement("canvas");
  const ctx = texture.getContext("2d");
  const lines = Array.from(paths, (path, index) => ({
    path: new Path2D(path.getAttribute("d")),
    color: LINE_COLORS[index],
    opacity: Number(path.style.getPropertyValue("--op")),
    speed: parseFloat(path.style.getPropertyValue("--ls")),
    cycle: parseFloat(path.style.getPropertyValue("--lc")),
    width: parseFloat(path.style.getPropertyValue("--sw")),
  }));
  return (width, height, time, moving) => {
    const scale = Math.min(1, 1280 / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    if (texture.width !== w) texture.width = w;
    if (texture.height !== h) texture.height = h;
    ctx.resetTransform();
    const fill = ctx.createLinearGradient(0, 0, w, h);
    fill.addColorStop(0, "#2a2d35");
    fill.addColorStop(.52, "#333842");
    fill.addColorStop(1, "#2a2d35");
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
    const artScale = Math.max(w * 1.4 / 1600, h * 1.28 / 1000);
    ctx.setTransform(artScale, 0, 0, artScale, (w - 1600 * artScale) / 2, (h - 1000 * artScale) / 2);
    ctx.setLineDash([12, 8, 2, 10].map((n) => n * scale / artScale));
    lines.forEach((line, index) => {
      const phase = ((time + index * 1.8) % line.cycle) / line.cycle;
      const fade = Math.min(1, phase * 4, (1 - phase) * 4);
      const flow = 1 - Math.abs(1 - ((time / line.speed + index * .4) % 2));
      ctx.globalAlpha = line.opacity * (moving ? fade * .88 : .5);
      ctx.strokeStyle = line.color;
      ctx.lineWidth = line.width * scale / artScale;
      ctx.lineDashOffset = (index % 2 ? 1 : -1) * flow * 400 * scale / artScale;
      ctx.stroke(line.path);
    });
    ctx.globalAlpha = 1;
    return texture;
  };
}

function visible(box, width, height) {
  const [x, y, w, h] = box;
  return w > 0 && h > 0 && x < width && y < height && x + w > 0 && y + h > 0;
}

function bounds(element, offsetX, offsetY) {
  const { left, top, width, height } = element.getBoundingClientRect();
  const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
  return [left + offsetX, top + offsetY, width, height, Math.min(radius, width / 2, height / 2)];
}

export function createGlassScene({ canvas, image, video, grid, paths, onFailure }) {
  const stage = canvas.parentElement;
  const root = document.documentElement;
  const opticalCanvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(1, 1) : null;
  const output = canvas.getContext("bitmaprenderer");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const makeLines = lineWallpaper(paths);
  const regular = [...document.querySelectorAll("#filterPanel, .auth-card")];
  const floating = [...document.querySelectorAll("header.top, .save-location, .appearance-popover, #downloadsPanel, .modal-card, #toast")];
  const plates = new Map();
  const stats = { frames: 0, backdropFrames: 0, uploads: 0, cards: 0, overlays: 0 };
  let renderer;
  let frame = 0;
  let settings;
  let cards = [];
  let layoutDirty = true;
  let backdropDirty = true;
  let mediaDirty = true;
  let mediaSource = null;
  let lastTick = -Infinity;
  let lastParallax;
  let mediaFrame = 0;
  let videoDirty = false;
  let lastVideoUpload = -Infinity;
  let needsPaint = true;
  let dprQuery;
  const menu = document.querySelector("#appearanceMenu");

  function schedule() {
    if (renderer && !frame && !document.hidden) frame = requestAnimationFrame(render);
  }

  function invalidate() {
    needsPaint = true;
    schedule();
  }

  function layoutChanged() {
    layoutDirty = true;
    invalidate();
  }

  function mediaChanged() {
    mediaDirty = backdropDirty = true;
    invalidate();
  }

  function watchVideo() {
    if (!video.requestVideoFrameCallback || mediaFrame || video.paused || document.hidden) return;
    mediaFrame = video.requestVideoFrameCallback(() => {
      mediaFrame = 0;
      videoDirty = true;
      schedule();
      watchVideo();
    });
  }

  function overlay(element, box, force) {
    const { scaleX, scaleY } = renderer;
    const [left, top, width, height] = box;
    const x = Math.max(0, Math.floor(left * scaleX));
    const y = Math.max(0, Math.floor(top * scaleY));
    const w = Math.min(canvas.width, Math.ceil((left + width) * scaleX)) - x;
    const h = Math.min(canvas.height, Math.ceil((top + height) * scaleY)) - y;
    const signature = box.concat(x, y, w, h, scaleX, scaleY).join(",");
    let plate = plates.get(element);
    if (!plate) {
      const layer = document.createElement("canvas");
      layer.className = "optical-plate";
      layer.setAttribute("aria-hidden", "true");
      element.prepend(layer);
      plate = { layer, context: layer.getContext("bitmaprenderer") };
      plates.set(element, plate);
    }
    if (plate.signature !== signature) {
      plate.signature = signature;
      const style = getComputedStyle(element);
      Object.assign(plate.layer.style, {
        left: `${x / scaleX - left - parseFloat(style.borderLeftWidth)}px`,
        top: `${y / scaleY - top - parseFloat(style.borderTopWidth)}px`,
        width: `${w / scaleX}px`,
        height: `${h / scaleY}px`,
      });
      if (plate.layer.width !== w) plate.layer.width = w;
      if (plate.layer.height !== h) plate.layer.height = h;
      force = true;
    }
    return force ? { box, crop: [x, y, w, h], context: plate.context } : null;
  }

  function render(now) {
    frame = 0;
    if (!renderer || !settings || document.hidden) return;
    try {
      renderScene(now);
      root.classList.add("glass-ready");
    } catch (error) {
      fail(error);
    }
  }

  function renderScene(now) {
    const motion = settings.effectsMotion && !reducedMotion.matches;
    const useLines = settings.wallpaperKind === "lines" || (settings.wallpaperKind === "video" && !settings.videoSrc);
    const movingLines = useLines && settings.wallpaperEnabled && !reducedMotion.matches;
    const animateBackdrop = movingLines || (motion && (settings.aurora > 0 || settings.particles > 0));
    const animateCaustics = motion && settings.caustics > 0;
    const animate = animateBackdrop || animateCaustics;
    const tick = animate && now - lastTick >= FRAME_INTERVAL - 1;
    const nextVideoFrame = videoDirty && now - lastVideoUpload >= FRAME_INTERVAL - 1;
    if (animate || videoDirty && !nextVideoFrame) schedule();
    if (!needsPaint && !tick && !nextVideoFrame) return;
    needsPaint = false;
    const stageRect = stage.getBoundingClientRect();
    const { width, height, left, top } = stageRect;
    if (!width || !height) return;
    const resized = renderer.resize(width, height, devicePixelRatio);
    if (tick) lastTick = now;
    const time = Number.isFinite(lastTick) ? lastTick / 1000 : 0;
    const parallax = settings.parallax * .09 * Math.tanh(scrollY / 900);

    const videoSelected = settings.wallpaperKind === "video" && Boolean(settings.videoSrc);
    let source = null;
    if (useLines && (mediaDirty || resized || movingLines && tick)) {
      source = makeLines(width, height, time, movingLines);
    } else if (videoSelected && video.readyState >= 2) {
      source = video;
    } else if (!useLines && !videoSelected && image.complete && image.naturalWidth) {
      source = image;
    } else if (useLines) {
      source = mediaSource;
    }
    const upload = source && (mediaDirty || source !== mediaSource
      || useLines && (resized || movingLines && tick) || videoSelected && nextVideoFrame);
    if (upload) {
      renderer.upload(source, source.videoWidth || source.naturalWidth || source.width,
        source.videoHeight || source.naturalHeight || source.height);
      stats.uploads++;
      if (videoSelected) lastVideoUpload = now;
    }
    if (nextVideoFrame || !videoSelected || upload && videoSelected) videoDirty = false;
    const compose = backdropDirty || resized || upload || source !== mediaSource
      || parallax !== lastParallax || animateBackdrop && tick;
    if (compose) {
      renderer.compose(settings, Boolean(source), motion ? time : 0, parallax);
      stats.backdropFrames++;
    }

    if (layoutDirty || resized) {
      cards = Array.from(grid.querySelectorAll(".asset-card"), (card) => bounds(card, scrollX, scrollY));
      layoutDirty = false;
    }
    const boxes = [];
    let cardCount = 0;
    // Geometry is cached in document space. Cull after converting to viewport
    // space, including half-visible rows, irrespective of scroll speed or IO.
    for (const [x, y, w, h, radius] of cards) {
      const box = [x - scrollX - left, y - scrollY - top, w, h, radius];
      if (visible(box, width, height)) {
        boxes.push(box);
        cardCount++;
      }
    }
    for (const element of regular) {
      const box = bounds(element, -left, -top);
      if (visible(box, width, height)) boxes.push(box);
    }
    const overlays = [];
    let shownOverlays = 0;
    for (const element of floating) {
      if (element.classList.contains("appearance-popover") && !menu.open) continue;
      const box = bounds(element, -left, -top);
      const show = visible(box, width, height) && getComputedStyle(element).visibility === "visible";
      if (!show) continue;
      shownOverlays++;
      const plate = overlay(element, box, compose || animateCaustics && tick);
      if (plate) overlays.push(plate);
    }
    renderer.paint(settings, boxes, overlays, motion ? time : 0);
    Object.assign(stats, { frames: stats.frames + 1, cards: cardCount, overlays: shownOverlays });
    mediaSource = source;
    mediaDirty = backdropDirty = false;
    lastParallax = parallax;
  }

  function fail(error) {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    renderer = null;
    root.classList.remove("glass-ready");
    onFailure(error);
  }

  function start() {
    try {
      if (!opticalCanvas || !output) throw new Error("Offscreen WebGL compositing is unavailable");
      renderer = new LiquidGlass(opticalCanvas, output);
      for (const plate of plates.values()) plate.signature = "";
      mediaChanged();
    } catch (error) {
      fail(error);
    }
  }

  const observeSize = new ResizeObserver(layoutChanged);
  for (const element of [stage, grid, document.querySelector("main"), ...regular, ...floating]) observeSize.observe(element);
  const observeVisibility = new MutationObserver(invalidate);
  for (const element of [document.body, menu, ...document.querySelectorAll(".modal"), ...floating]) {
    observeVisibility.observe(element, { attributes: true, attributeFilter: ["class", "open"] });
  }
  function watchDpr() {
    dprQuery?.removeEventListener("change", watchDpr);
    dprQuery = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    dprQuery.addEventListener("change", watchDpr, { once: true });
    layoutChanged();
  }

  window.addEventListener("fabgui:results-rendered", layoutChanged);
  window.addEventListener("scroll", invalidate, { passive: true });
  window.addEventListener("resize", layoutChanged);
  window.visualViewport?.addEventListener("resize", layoutChanged);
  reducedMotion.addEventListener("change", mediaChanged);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && mediaFrame) {
      video.cancelVideoFrameCallback(mediaFrame);
      mediaFrame = 0;
    }
    mediaChanged();
    watchVideo();
  });
  image.addEventListener("load", mediaChanged);
  image.addEventListener("error", mediaChanged);
  video.addEventListener("loadeddata", mediaChanged);
  video.addEventListener("seeked", mediaChanged);
  video.addEventListener("playing", watchVideo);
  if (!video.requestVideoFrameCallback) video.addEventListener("timeupdate", mediaChanged);
  opticalCanvas?.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    fail(new Error("WebGL context lost"));
  });
  opticalCanvas?.addEventListener("webglcontextrestored", start);
  watchDpr();
  start();

  return {
    update(next) {
      const redrawMedia = !settings || next.wallpaperKind !== settings.wallpaperKind
        || next.videoSrc !== settings.videoSrc || next.wallpaperEnabled !== settings.wallpaperEnabled;
      settings = { ...next };
      if (redrawMedia) mediaChanged();
      backdropDirty = true;
      invalidate();
    },
    get stats() { return { ...stats, size: [canvas.width, canvas.height] }; },
  };
}
