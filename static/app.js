"use strict";

const FILTER_STORAGE_KEY = "fabgui.libraryView.v1";
const state = {
  results: [],
  pending: null,
  filters: loadSavedFilters(),
};

const $ = (selector) => document.querySelector(selector);

function loadSavedFilters() {
  const defaults = { query: "", engine: "", category: "", format: "", platform: "", sort: "latest" };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) || "{}") }; }
  catch (error) { return defaults; }
}

function saveFilters() {
  try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(state.filters)); } catch (error) {}
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let result = null;
  try { result = await response.json(); } catch (error) { result = null; }
  if (!response.ok) throw new Error((result && result.message) || (result && result.error && result.error.message) || "Request failed");
  return result;
}

function esc(value) {
  return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let index = -1;
  let output = bytes;
  do { output /= 1024; index++; } while (output >= 1024 && index < units.length - 1);
  return `${output.toFixed(output < 10 ? 2 : 1)} ${units[index]}`;
}

function slugify(value) {
  return String(value || "fab-asset")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "fab-asset";
}

function compareVersions(a, b) {
  const left = String(a).match(/\d+/g) || [];
  const right = String(b).match(/\d+/g) || [];
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (Number(left[index]) || 0) - (Number(right[index]) || 0);
    if (difference) return difference;
  }
  return String(a).localeCompare(String(b));
}

function normalizeEngine(engine) {
  const value = String(engine || "").trim();
  if (/^UE_?\d+\.\d+$/i.test(value)) return value.replace(/^UE(\d)/i, "UE_$1");
  return "";
}

function assetVersions(asset) {
  const versions = new Set();
  (asset.projectVersions || []).forEach((projectVersion) => {
    (projectVersion.engineVersions || projectVersion.engine_versions || []).forEach((engine) => {
      const normalized = normalizeEngine(engine);
      if (normalized) versions.add(normalized);
    });
  });
  return [...versions].sort(compareVersions).reverse();
}

function latestEngine(asset) { return assetVersions(asset)[0] || ""; }

function libraryUid(asset) {
  const attributes = asset.customAttributes || asset.custom_attributes || [];
  for (const attribute of Array.isArray(attributes) ? attributes : [attributes]) {
    const uid = attribute && (attribute.ListingIdentifier || attribute.listingIdentifier);
    if (uid) return String(uid);
  }
  return "";
}

function listingUid(asset) {
  // Downloads must use Fab's ListingIdentifier, never the library asset id.
  return libraryUid(asset) || String(asset.uid || asset.listing_uid || asset.listingUid || "");
}

function assetPlatforms(asset, engine = "") {
  const selectedEngine = normalizeEngine(engine);
  const platforms = new Set();
  (asset.projectVersions || []).forEach((projectVersion) => {
    const supportedEngines = (projectVersion.engineVersions || projectVersion.engine_versions || [])
      .map(normalizeEngine).filter(Boolean);
    if (selectedEngine && supportedEngines.length && !supportedEngines.includes(selectedEngine)) return;
    (projectVersion.targetPlatforms || projectVersion.target_platforms || []).forEach((platform) => {
      if (platform) platforms.add(String(platform));
    });
  });
  return [...platforms];
}

function categoryNames(asset) {
  const value = asset.categories || asset.category || [];
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map((item) => typeof item === "string" ? item.trim()
    : String((item && (item.name || item.title || item.label)) || "").trim()).filter(Boolean))];
}

function distributionMethod(asset) {
  return String(asset.distributionMethod || asset.distribution_method || "").trim();
}

function formatLabel(value) {
  return String(value || "Unknown").replace(/[_-]+/g, " ").toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function plainText(value) {
  const element = document.createElement("div");
  element.innerHTML = String(value || "");
  return (element.textContent || element.innerText || "").replace(/\s+/g, " ").trim();
}

const jobWatchers = {};

function closeEventSource(jobId) {
  if (jobWatchers[jobId]?.eventSource) {
    jobWatchers[jobId].eventSource.close();
  }
}

function watchJob(jobId, onSuccess, onError) {
  if (jobWatchers[jobId]) return;
  let alive = true;
  let timer = null;
  const tick = async () => {
    if (!alive) return;
    try {
      const job = await api(`/api/jobs/${jobId}`);
      if (job.state === "success") {
        alive = false; clearTimeout(timer); closeEventSource(jobId);
        if (onSuccess) onSuccess(job.result);
      } else if (job.state === "error") {
        alive = false; clearTimeout(timer); closeEventSource(jobId);
        if (onError) onError(job.result || job.error);
      } else {
        timer = setTimeout(tick, 2000);
      }
    } catch (error) {
      timer = setTimeout(tick, 3000);
    }
  };
  timer = setTimeout(tick, 1200);
  jobWatchers[jobId] = { tick, eventSource: null };
}

function openEventSource(jobId, onProgress) {
  closeEventSource(jobId);
  const eventSource = new EventSource(`/api/jobs/${jobId}/progress`);
  if (jobWatchers[jobId]) jobWatchers[jobId].eventSource = eventSource;
  eventSource.onmessage = (event) => {
    try { if (onProgress) onProgress(JSON.parse(event.data)); } catch (error) {}
  };
}

function setupFilters() {
  const engines = [...new Set(state.results.flatMap(assetVersions))].sort(compareVersions).reverse();
  const engineSelect = $("#engineFilter");
  engineSelect.innerHTML = `<option value="">All engines (${state.results.length})</option>` + engines.map((engine) => {
    const count = state.results.filter((asset) => assetVersions(asset).includes(engine)).length;
    return `<option value="${esc(engine)}">${esc(engine)} (${count})</option>`;
  }).join("");
  if (engines.includes(state.filters.engine)) engineSelect.value = state.filters.engine;
  else state.filters.engine = "";

  function populate(selector, values, selected, allLabel, labelFormatter = (value) => value) {
    const select = $(selector);
    const counts = new Map();
    state.results.forEach((asset) => values(asset).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1)));
    const unique = [...counts.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    select.innerHTML = `<option value="">${esc(allLabel)} (${state.results.length})</option>` + unique.map((value) =>
      `<option value="${esc(value)}">${esc(labelFormatter(value))} (${counts.get(value)})</option>`).join("");
    select.value = unique.includes(selected) ? selected : "";
  }

  populate("#categoryFilter", categoryNames, state.filters.category, "All categories");
  populate("#formatFilter", (asset) => distributionMethod(asset) ? [distributionMethod(asset)] : [], state.filters.format, "All formats", formatLabel);
  populate("#platformFilter", (asset) => assetPlatforms(asset, state.filters.engine), state.filters.platform, "All platforms");

  $("#librarySearch").value = state.filters.query;
  document.querySelectorAll("[data-sort]").forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.sort === state.filters.sort)));
  saveFilters();
}

function filteredResults() {
  const query = state.filters.query.trim().toLocaleLowerCase();
  return state.results.filter((asset) => {
    const categories = categoryNames(asset);
    const engines = assetVersions(asset);
    const platforms = assetPlatforms(asset, state.filters.engine);
    if (state.filters.engine && !engines.includes(state.filters.engine)) return false;
    if (state.filters.category && !categories.includes(state.filters.category)) return false;
    if (state.filters.format && distributionMethod(asset) !== state.filters.format) return false;
    if (state.filters.platform && !platforms.includes(state.filters.platform)) return false;
    if (query) {
      const haystack = [asset.title, asset.id, listingUid(asset), distributionMethod(asset), categories.join(" "), plainText(asset.description)].join(" ").toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }).sort((a, b) => {
    if (state.filters.sort === "title") return String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" });
    const engineDifference = compareVersions(latestEngine(b) || "0", latestEngine(a) || "0");
    return engineDifference || String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" });
  });
}

async function loadLibrary() {
  $("#resultsLoading").classList.remove("hidden");
  $("#resultsEmpty").classList.add("hidden");
  try {
    const response = await api("/api/library");
    state.results = (response.data && response.data.results) || [];
    state.results.forEach((asset) => { asset.owned = true; });
    setupFilters();
    renderResults();
  } catch (error) {
    toast("Failed to load library: " + error.message, "error");
  } finally {
    $("#resultsLoading").classList.add("hidden");
  }
}

function renderResults() {
  const grid = $("#resultsGrid");
  const empty = $("#resultsEmpty");
  const rows = filteredResults();
  $("#resultCount").textContent = `${rows.length} of ${state.results.length} item(s)`;
  if (!rows.length) {
    grid.classList.add("hidden");
    empty.textContent = state.results.length ? "No items match these filters. Try clearing one or more filters." : "Your owned library is empty.";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  grid.classList.remove("hidden");
  grid.innerHTML = rows.map(rowHtml).join("");
}

function assetImage(asset) {
  for (const key of ["thumbnail", "thumbnailUrl", "thumbnail_url", "coverImage", "cover_image", "image", "icon", "previewImage", "preview_image", "bannerImage", "posterImage"]) {
    if (asset[key]) return asset[key];
  }
  const media = asset.media || asset.assets || asset.images || asset.screenshots;
  if (Array.isArray(media) && media.length) {
    const first = media[0];
    if (typeof first === "string") return first;
    if (first && (first.url || first.thumbnail || first.image)) return first.url || first.thumbnail || first.image;
  }
  return null;
}

function rowHtml(asset) {
  const uid = listingUid(asset);
  const title = asset.title || "Untitled";
  const image = assetImage(asset);
  const engine = latestEngine(asset);
  const categories = categoryNames(asset).slice(0, 2);
  const method = distributionMethod(asset);
  const imageCell = image
    ? `<img src="${esc(image)}" class="asset-card-img" alt="${esc(title)}" loading="lazy">`
    : `<div class="asset-card-placeholder">–</div>`;
  const chips = [
    engine ? `<span class="asset-meta-chip engine">${esc(engine.replace("UE_", "UE "))}</span>` : "",
    ...categories.map((category) => `<span class="asset-meta-chip category">${esc(category)}</span>`),
    method ? `<span class="asset-meta-chip">${esc(formatLabel(method))}</span>` : "",
  ].filter(Boolean).join("");
  return `<div class="asset-card" data-uid="${esc(uid)}" data-title="${esc(title)}">
    ${imageCell}<div class="asset-card-body"><div class="asset-card-title">${esc(title)}</div>${chips ? `<div class="asset-card-meta">${chips}</div>` : ""}</div>
  </div>`;
}

async function openDownloadModal(uid, title) {
  const asset = state.results.find((item) => listingUid(item) === uid);
  if (!asset) {
    toast("Could not match this card to a library item. Refresh and try again.", "error");
    return;
  }
  const engines = assetVersions(asset);
  if (!engines.length) {
    toast("This listing has no Unreal Engine versions in FabCLI library metadata.", "error");
    return;
  }
  state.pending = { uid, title, asset };
  $("#engineModalTitle").textContent = title || uid;
  $("#engineModalDir").textContent = slugify(title || uid);

  const engineSelect = $("#engineSelect");
  engineSelect.innerHTML = engines.map((engine) =>
    `<option value="${esc(engine)}">${esc(engine.replace("UE_", "UE "))}</option>`).join("");

  const platformSelect = $("#downloadPlatformSelect");
  function refreshPlatforms() {
    const platforms = assetPlatforms(asset, engineSelect.value);
    platformSelect.innerHTML = platforms.map((platform) =>
      `<option value="${esc(platform)}">${esc(platform)}</option>`).join("");
    if (platforms.includes("Windows")) platformSelect.value = "Windows";
  }
  engineSelect.onchange = refreshPlatforms;
  refreshPlatforms();
  $("#engineModal").classList.remove("hidden");
}

async function confirmDownload() {
  const pending = state.pending;
  if (!pending) return;
  const health = await api("/api/health").catch(() => ({ download_dir: "" }));
  const body = {
    uid: pending.uid,
    output_dir: health.download_dir || "",
    engine: $("#engineSelect").value,
    platform: $("#downloadPlatformSelect").value,
    jobs: 8,
  };

  try {
    const response = await api("/api/download", { method: "POST", body });
    $("#engineModal").classList.add("hidden");
    state.pending = null;
    if (!response.ok) {
      toast("Download failed: " + (response.message || "unknown"), "error");
      return;
    }
    toast("Download started…", "loading");
    const jobId = response.job_id;
    if (!jobId) return;
    addJobRow(jobId, $("#engineModalTitle").textContent || pending.uid, $("#engineSelect").value, $("#downloadPlatformSelect").value);
    openEventSource(jobId, (progress) => updateJobProgress(jobId, progress));
    watchJob(jobId, (result) => {
      const row = document.getElementById("job-" + jobId);
      if (row) {
        const statusCell = row.querySelector(".job-status");
        const bar = row.querySelector(".progress-bar > div");
        if (bar) bar.style.width = "100%";
        if (statusCell) {
          statusCell.textContent = result.ok ? "Done!" : "Failed";
          statusCell.className = "job-status " + (result.ok ? "success" : "error");
        }
      }
      if (result.ok) toast(`Download complete: ${result.data.files} files, ${fmtBytes(result.data.total_bytes)}`, "success");
      else toast("Download failed: " + (result.message || "unknown"), "error");
    }, (error) => {
      const row = document.getElementById("job-" + jobId);
      if (row) {
        const statusCell = row.querySelector(".job-status");
        if (statusCell) { statusCell.textContent = "Failed"; statusCell.className = "job-status error"; }
      }
      toast("Download failed: " + (error.message || "unknown"), "error");
    });
  } catch (error) {
    toast("Download failed: " + error.message, "error");
  }
}

const jobProgress = {};

function addJobRow(jobId, title, engine, platform) {
  const body = $("#jobsBody");
  if (!body) return;
  const row = document.createElement("tr");
  row.id = "job-" + jobId;
  row.innerHTML = `
    <td class="w-check"><span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:6px;"></span></td>
    <td class="cell-title" title="${esc(title)}">${esc(title)}</td>
    <td class="job-status running">Starting · ${esc(engine.replace("UE_", "UE "))} / ${esc(platform)}</td>
    <td class="job-progress"><div class="progress-bar"><div></div></div><span style="font-size:0.8em;color:#aaa">0%</span></td>
  `;
  body.appendChild(row);
}

function updateJobProgress(jobId, progress) {
  const body = $("#jobsBody");
  if (!body) return;
  let row = document.getElementById("job-" + jobId);
  if (!row) return;
  const cells = row.querySelectorAll("td");
  if (cells.length < 4) return;
  const percent = progress.percent != null ? Math.round(progress.percent) : null;
  const statusCell = cells[2];
  const progressCell = cells[3];
  const bar = progressCell.querySelector(".progress-bar > div");
  const pctText = progressCell.querySelector("span");
  let pct = percent;
  if (pct == null) {
    jobProgress[jobId] = Math.min(90, (jobProgress[jobId] || 0) + 2);
    pct = jobProgress[jobId];
    statusCell.textContent = "Downloading · " + pct + "%";
    statusCell.className = "job-status running";
  }
    if (bar) bar.style.width = percent + "%";
    if (pctText) pctText.textContent = percent + "%";
    if (percent >= 100) {
      statusCell.textContent = "Processing…";
      statusCell.className = "job-status running";
    } else {
      statusCell.textContent = "Downloading · " + percent + "%";
      statusCell.className = "job-status running";
    }
  }
  const downloaded = progress.downloaded_bytes != null ? fmtBytes(progress.downloaded_bytes) : "";
  const total = progress.total_bytes != null ? fmtBytes(progress.total_bytes) : "";
  const dlRate = progress.download_speed ? fmtBytes(progress.download_speed) + "/s" : "";
  const detail = [downloaded, total ? "/" + total : "", dlRate].filter(Boolean).join(" ");
  if (detail) statusCell.textContent = (statusCell.textContent.split(" · ")[0] || "Downloading") + " · " + detail;
  // clear the spinner once we have progress
  const spin = row.querySelector(".spinner");
  if (spin) spin.style.display = "none";
}

async function copyUid(uid, anchor) {
  let success = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(uid);
      success = true;
    } else {
      throw new Error("clipboard api unavailable");
    }
  } catch (error) {
    const textArea = document.createElement("textarea");
    textArea.value = uid;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.select();
    try { success = document.execCommand("copy"); } catch (fallbackError) { success = false; }
    document.body.removeChild(textArea);
  }
  toast(success ? "Listing UID copied to clipboard" : "Failed to copy listing UID", success ? "success" : "error", anchor);
}

function setFilter(key, value) { state.filters[key] = value; saveFilters(); renderResults(); }
function clearFilters() {
  state.filters = { query: "", engine: "", category: "", format: "", platform: "", sort: "latest" };
  setupFilters(); renderResults();
}

/* ---------------------------------------------------------------- auth */

async function refreshAuthTab() {
  const d = await api("/api/auth/status").catch(() => ({ ok: false }));
  if (!d || !d.ok) { $("#authStatusText").textContent = "Status unavailable"; return; }
  if (d.authenticated) {
    $("#authStatusText").textContent = "Signed in";
    const fab = d.fab || {};
    $("#authEpicState").textContent = "OK";
    $("#authEpicExpires").textContent = d.expires_at || "—";
    $("#fabSessionState").textContent = fab.session_present ? (fab.needs_refresh ? "Expired / needs refresh" : "OK") : "No Fab session";
    $("#fabSessionDays").textContent = fab.days_remaining != null ? String(fab.days_remaining) : "—";
  } else {
    $("#authStatusText").textContent = "Not signed in";
    $("#authEpicState").textContent = "—";
    $("#authEpicExpires").textContent = "—";
    $("#fabSessionState").textContent = "—";
    $("#fabSessionDays").textContent = "—";
  }
  let who = { display_name: "—", email: "—" };
  try { const w = await api("/api/auth/whoami"); who = w.data || who; } catch (error) {}
  $("#whoDisplayName").textContent = who.display_name || "—";
  $("#whoEmail").textContent = who.email || "—";
}

/* Toast notification with optional spinner. Kind: info | success | error.
   When kind is "loading" it shows a spinning wheel; on success it shows a
   green check mark with "Done!". */
function toast(msg, kind, anchorEl) {
  const t = $("#toast");
  if (!t) return;
  const isLoading = kind === "loading";
  const isSuccess = kind === "success";
  t.textContent = "";
  const icon = document.createElement("span");
  icon.style.marginRight = "8px";
  icon.style.fontSize = "14px";
  if (isLoading) {
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" style="display:inline-block;animation:rotate 1s linear infinite"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/></svg>';
    t.textContent = msg;
    t.prepend(icon);
    t.className = "toast loading show";
    t.style.opacity = "1";
    t.style.visibility = "visible";
    t.style.display = "";
    t.style.transform = "";
    t.style.transition = "";
    t.style.position = "fixed";
    t.style.left = "50%";
    t.style.bottom = "22px";
    t.style.top = "auto";
    t.style.transform = "translateX(-50%)";
    clearTimeout(toast._timer);
    return;
  }
  if (isSuccess) {
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" style="display:inline-block"><polyline points="20 6 9 17 4 12" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    t.textContent = msg;
    t.prepend(icon);
    t.className = "toast success show";
  } else if (kind === "error") {
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" style="display:inline-block"><polyline points="20 6 9 17 4 12" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    t.textContent = msg;
    t.prepend(icon);
    t.className = "toast error show";
  } else {
    t.textContent = msg;
    t.className = "toast info show";
  }
  t.style.opacity = "1";
  t.style.visibility = "visible";
  t.style.display = "";
  t.style.transform = "";
  t.style.transition = "";
  t.style.position = "fixed";
  t.style.left = "50%";
  t.style.bottom = "22px";
  t.style.top = "auto";
  t.style.transform = "translateX(-50%)";
  clearTimeout(toast._timer);
  if (kind !== "error") {
    toast._timer = setTimeout(() => { t.classList.remove("show"); }, 5000);
  }
}

async function startLogin() {
  toast("Starting Fab login (a browser window should open)…", "info");
  const j = await api("/api/auth/login", { method: "POST", body: { manual: false } });
  watchJob(j.job_id, async (res) => {
    if (res.ok) { toast("Login finished. Checking status…", "info"); await refreshAuthTab(); }
    else { toast("Login failed: " + (res.message || "unknown"), "error"); }
  }, async (err) => { toast("Login failed: " + (err.message || "unknown"), "error"); });
}

async function doLogout() {
  await api("/api/auth/logout", { method: "POST", body: {} });
  await refreshAuthTab();
  toast("Logged out", "info");
}

async function init() {
  document.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => {
    state.filters.sort = button.dataset.sort;
    document.querySelectorAll("[data-sort]").forEach((tab) => tab.setAttribute("aria-pressed", String(tab === button)));
    saveFilters(); renderResults();
  }));
  $("#librarySearch").addEventListener("input", (event) => setFilter("query", event.target.value));
  [["#engineFilter", "engine"], ["#categoryFilter", "category"], ["#formatFilter", "format"], ["#platformFilter", "platform"]].forEach(([selector, key]) =>
    $(selector).addEventListener("change", (event) => setFilter(key, event.target.value)));
  $("#clearFilters").addEventListener("click", clearFilters);
  $("#btnHelp").addEventListener("click", () => $("#helpModal").classList.remove("hidden"));
  $("#helpModalClose").addEventListener("click", () => $("#helpModal").classList.add("hidden"));
  $("#btnLogin").addEventListener("click", startLogin);
  $("#btnLogout").addEventListener("click", doLogout);
  $("#resultsGrid").addEventListener("click", (event) => {
    const card = event.target.closest(".asset-card");
    if (card && card.dataset.uid) openDownloadModal(card.dataset.uid, card.dataset.title);
  });
  $("#resultsGrid").addEventListener("contextmenu", (event) => {
    const card = event.target.closest(".asset-card");
    if (!card) return;
    event.preventDefault();
    if (card.dataset.uid) {
      copyUid(card.dataset.uid, card);
      card.classList.add("copied");
      setTimeout(() => card.classList.remove("copied"), 800);
    }
  });
  $("#engineModalCancel").addEventListener("click", () => { $("#engineModal").classList.add("hidden"); state.pending = null; });
  $("#engineModalConfirm").addEventListener("click", confirmDownload);
  await loadLibrary();
  await refreshAuthTab();
}

/* Expose the helpers the interaction-fix module (and DevTools console) needs.
   interaction-fix captures card clicks in the capture phase and calls these
   directly, so they must be reachable on window, otherwise clicking Download
   silently does nothing. */
window.api = api;
window.state = state;
window.openDownloadModal = openDownloadModal;
window.addJobRow = addJobRow;
window.watchJob = watchJob;
window.openEventSource = openEventSource;
window.fmtBytes = fmtBytes;
window.toast = toast;
window.slugify = slugify;

document.addEventListener("DOMContentLoaded", init);
