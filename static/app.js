"use strict";

const FILTER_STORAGE_KEY = "fabgui.libraryView.v1";
const state = {
  results: [],
  pending: null,
  filters: loadSavedFilters(),
};

const $ = (s) => document.querySelector(s);

function loadSavedFilters() {
  const defaults = { query: "", engine: "", category: "", format: "", platform: "", sort: "latest" };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) || "{}") }; }
  catch (e) { return defaults; }
}

function saveFilters() {
  try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(state.filters)); } catch (e) {}
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null;
  try { j = await res.json(); } catch (e) { j = null; }
  if (!res.ok) throw new Error((j && j.message) || (j && j.error && j.error.message) || "Request failed");
  return j;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let i = -1, out = v;
  do { out /= 1024; i++; } while (out >= 1024 && i < units.length - 1);
  return `${out.toFixed(out < 10 ? 2 : 1)} ${units[i]}`;
}

function slugify(s) {
  const slug = String(s || "asset").toLowerCase().trim().replace(/[^a-z-0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "asset";
}

function toast(msg, kind, anchorEl) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.className = "toast " + (kind || "info") + " show";
  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    t.style.position = "fixed";
    t.style.left = (rect.left + rect.width / 2 - t.offsetWidth / 2) + "px";
    t.style.top = (rect.top + rect.height / 2 - t.offsetHeight / 2) + "px";
  } else {
    t.style.position = "fixed";
    t.style.left = "50%";
    t.style.bottom = "22px";
    t.style.top = "auto";
    t.style.transform = "translateX(-50%)";
  }
  clearTimeout(toast._timer);
  if (kind !== "error") toast._timer = setTimeout(() => t.classList.remove("show"), 5000);
}

function categoryNames(r) {
  const value = r.categories || r.category || [];
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map((item) => typeof item === "string" ? item.trim() : String((item && (item.name || item.title || item.label)) || "").trim()).filter(Boolean))];
}

function distributionMethod(r) { return String(r.distributionMethod || r.distribution_method || "").trim(); }
function formatLabel(value) { return String(value || "Unknown").replace(/[_-]+/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }

function compareVersions(a, b) {
  const aa = String(a).match(/\d+/g) || [], bb = String(b).match(/\d+/g) || [];
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const diff = (Number(aa[i]) || 0) - (Number(bb[i]) || 0);
    if (diff) return diff;
  }
  return String(a).localeCompare(String(b));
}

function assetVersions(r) {
  // Use only explicitly supported engineVersions. buildVersion strings may
  // advertise an engine newer than the actual downloadable listing supports.
  const versions = new Set();
  (r.projectVersions || []).forEach((pv) => (pv.engineVersions || pv.engine_versions || []).forEach((engine) => {
    if (engine && /^UE_?\d+\.\d+$/i.test(String(engine))) versions.add(String(engine).replace(/^UE(\d)/i, "UE_$1"));
  }));
  return [...versions].sort(compareVersions).reverse();
}

function latestEngine(r) { return assetVersions(r)[0] || ""; }
function listingUid(r) {
  // Fab downloads expect the listing UUID, not the library's internal assetId.
  return libraryUid(r) || r.uid || r.listing_uid || r.listingUid || r.id || "";
}

function libraryUid(r) {
  const attrs = r.customAttributes || r.custom_attributes || [];
  for (const attr of Array.isArray(attrs) ? attrs : [attrs]) {
    const uid = attr && (attr.ListingIdentifier || attr.listingIdentifier);
    if (uid) return String(uid);
  }
  return "";
}

function plainText(value) {
  const el = document.createElement("div");
  el.innerHTML = String(value || "");
  return (el.textContent || el.innerText || "").replace(/\s+/g, " ").trim();
}

const jobWatchers = {};
const jobEventSources = {};
function watchJob(jid, onSuccess, onError) {
  if (jobWatchers[jid]) return;
  let alive = true, timer = null;
  const tick = async () => {
    if (!alive) return;
    try {
      const j = await api(`/api/jobs/${jid}`);
      if (j.state === "success") { alive = false; clearTimeout(timer); closeEventSource(jid); if (onSuccess) onSuccess(j.result); return; }
      if (j.state === "error") { alive = false; clearTimeout(timer); closeEventSource(jid); if (onError) onError(j.result || j.error); return; }
      timer = setTimeout(tick, 2000);
    } catch (e) { timer = setTimeout(tick, 3000); }
  };
  timer = setTimeout(tick, 1200);
  jobWatchers[jid] = () => { alive = false; clearTimeout(timer); closeEventSource(jid); };
}

function closeEventSource(jid) {
  if (jobEventSources[jid]) { jobEventSources[jid].close(); delete jobEventSources[jid]; }
}
function openEventSource(jid, onProgress) {
  closeEventSource(jid);
  const es = new EventSource(`/api/jobs/${jid}/progress`);
  jobEventSources[jid] = es;
  es.onmessage = (ev) => { try { if (onProgress) onProgress(JSON.parse(ev.data)); } catch (e) {} };
}

function populateSelect(selector, values, selected, allLabel, labelFn = (v) => v) {
  const select = $(selector), counts = new Map();
  state.results.forEach((item) => values(item).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1)));
  const unique = [...counts.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  select.innerHTML = `<option value="">${esc(allLabel)} (${state.results.length})</option>` + unique.map((v) => `<option value="${esc(v)}">${esc(labelFn(v))} (${counts.get(v)})</option>`).join("");
  select.value = unique.includes(selected) ? selected : "";
}

function setupFilters() {
  const engines = [...new Set(state.results.flatMap(assetVersions))].sort(compareVersions).reverse();
  populateSelect("#engineFilter", assetVersions, state.filters.engine, "All engines");
  populateSelect("#categoryFilter", categoryNames, state.filters.category, "All categories");
  populateSelect("#formatFilter", (r) => distributionMethod(r) ? [distributionMethod(r)] : [], state.filters.format, "All formats", formatLabel);
  populateSelect("#platformFilter", (r) => [...new Set((r.projectVersions || []).flatMap((pv) => pv.targetPlatforms || pv.target_platforms || []))], state.filters.platform, "All platforms");
  const select = $("#engineFilter");
  select.innerHTML = `<option value="">All engines (${state.results.length})</option>` + engines.map((engine) => {
    const count = state.results.filter((r) => assetVersions(r).includes(engine)).length;
    return `<option value="${esc(engine)}">${esc(engine)} (${count})</option>`;
  }).join("");
  if (engines.includes(state.filters.engine)) select.value = state.filters.engine; else state.filters.engine = "";
  $("#librarySearch").value = state.filters.query;
  document.querySelectorAll("[data-sort]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.sort === state.filters.sort)));
  saveFilters();
}

function filteredResults() {
  const query = state.filters.query.trim().toLocaleLowerCase();
  return state.results.filter((r) => {
    const categories = categoryNames(r), engines = assetVersions(r);
    const platforms = [...new Set((r.projectVersions || []).flatMap((pv) => pv.targetPlatforms || pv.target_platforms || []))];
    if (state.filters.engine && !engines.includes(state.filters.engine)) return false;
    if (state.filters.category && !categories.includes(state.filters.category)) return false;
    if (state.filters.format && distributionMethod(r) !== state.filters.format) return false;
    if (state.filters.platform && !platforms.includes(state.filters.platform)) return false;
    if (query) {
      const haystack = [r.title, r.id, listingUid(r), distributionMethod(r), categories.join(" "), plainText(r.description)].join(" ").toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }).sort((a, b) => {
    if (state.filters.sort === "title") return String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" });
    const diff = compareVersions(latestEngine(b) || "0", latestEngine(a) || "0");
    return diff || String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" });
  });
}

async function loadLibrary() {
  $("#resultsLoading").classList.remove("hidden");
  $("#resultsEmpty").classList.add("hidden");
  try {
    const j = await api("/api/library");
    state.results = (j.data && j.data.results) || [];
    state.results.forEach((r) => { r.owned = true; });
    setupFilters();
    renderResults();
  } catch (e) { toast("Failed to load library: " + e.message, "error"); }
  finally { $("#resultsLoading").classList.add("hidden"); }
}

function renderResults() {
  const wrap = $("#resultsGrid"), empty = $("#resultsEmpty"), loading = $("#resultsLoading"), rows = filteredResults();
  $("#resultCount").textContent = `${rows.length} of ${state.results.length} item(s)`;
  if (!rows.length) {
    wrap.classList.add("hidden");
    empty.textContent = state.results.length ? "No items match these filters. Try clearing one or more filters." : "Your owned library is empty.";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  if (!loading.classList.contains("hidden")) loading.classList.add("hidden");
  wrap.classList.remove("hidden");
  wrap.innerHTML = rows.map(rowHtml).join("");
}

function assetImage(r) {
  const images = r.images || [];
  const featured = images.find((image) => image && String(image.type || "").toLowerCase() === "featured");
  if (featured && featured.url) return featured.url;
  for (const key of ["thumbnail", "thumbnailUrl", "thumbnail_url", "coverImage", "cover_image", "image", "icon", "previewImage", "preview_image", "bannerImage", "posterImage"]) if (r[key]) return r[key];
  const media = r.media || r.assets || r.images || r.screenshots;
  if (Array.isArray(media) && media.length) {
    const first = media[0];
    if (typeof first === "string") return first;
    if (first && (first.url || first.thumbnail || first.image)) return first.url || first.thumbnail || first.image;
  }
  return null;
}

function rowHtml(r) {
  const uid = listingUid(r), title = r.title || "Untitled", img = assetImage(r);
  const categories = categoryNames(r).slice(0, 2), engine = latestEngine(r), method = distributionMethod(r);
  const imgCell = img ? `<img src="${esc(img)}" class="asset-card-img" alt="${esc(title)}" loading="lazy">` : `<div class="asset-card-placeholder">–</div>`;
  const chips = [engine ? `<span class="asset-meta-chip engine">${esc(engine.replace("UE_", "UE "))}</span>` : "",
    ...categories.map((category) => `<span class="asset-meta-chip category" title="${esc(category)}">${esc(category)}</span>`),
    method ? `<span class="asset-meta-chip">${esc(formatLabel(method))}</span>` : ""].filter(Boolean).join("");
  return `<div class="asset-card" data-uid="${esc(uid)}" data-title="${esc(title)}">${imgCell}<div class="asset-card-body"><div class="asset-card-title" title="${esc(title)}">${esc(title)}</div>${chips ? `<div class="asset-card-meta">${chips}</div>` : ""}</div></div>`;
}

async function openDownloadModal(uid, title) {
  const asset = state.results.find((item) => listingUid(item) === uid);
  if (!asset) { toast("Could not find this library item. Reload the library and try again.", "error"); return; }
  const engines = assetVersions(asset);
  if (!engines.length) { toast("FabCLI lists no supported Unreal Engine versions for this item.", "error"); return; }
  state.pending = { uid, title, asset };
  $("#engineModalTitle").textContent = title || uid;
  $("#engineModalDir").textContent = slugify(title || uid);
  $("#engineSelect").innerHTML = engines.map((engine) => `<option value="${esc(engine)}">${esc(engine.replace("UE_", "UE "))}</option>`).join("");
  const platforms = [...new Set((asset.projectVersions || []).filter((pv) => (pv.engineVersions || pv.engine_versions || []).some((engine) => engines.includes(engine))).flatMap((pv) => pv.targetPlatforms || pv.target_platforms || []))];
  const platformSelect = $("#downloadPlatformSelect");
  platformSelect.innerHTML = platforms.map((platform) => `<option value="${esc(platform)}">${esc(platform)}</option>`).join("");
  if (platforms.includes("Windows")) platformSelect.value = "Windows";
  $("#engineModal").classList.remove("hidden");
}

async function confirmDownload() {
  const pending = state.pending;
  if (!pending) return;
  const body = {
    uid: pending.uid,
    output_dir: `${location.origin ? "" : ""}`, // server/default output is used unless configured below
    engine: $("#engineSelect").value,
    platform: $("#downloadPlatformSelect").value,
    jobs: 8,
  };
  delete body.output_dir;
  try {
    const j = await api("/api/download", { method: "POST", body });
    $("#engineModal").classList.add("hidden");
    state.pending = null;
    if (!j.ok) { toast("Download failed: " + (j.message || "unknown"), "error"); return; }
    toast("Download started…", "info");
    if (!j.job_id) { toast("No job ID returned", "error"); return; }
    openEventSource(j.job_id, (progress) => updateJobProgress(j.job_id, progress));
    watchJob(j.job_id, (result) => {
      if (result.ok) toast(`Download complete: ${result.data.files} files, ${fmtBytes(result.data.total_bytes)}`, "success");
      else toast("Download failed: " + (result.message || "unknown"), "error");
    }, (error) => toast("Download failed: " + (error.message || "unknown"), "error"));
  } catch (error) {
    toast("Download failed: " + error.message, "error");
  }
}

function updateJobProgress(jid, progress) {
  const body = $("#jobsBody");
  if (!body) return;
  for (const row of body.querySelectorAll("tr")) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 2 || cells[0].textContent !== jid) continue;
    const pct = progress.percent != null ? Math.round(progress.percent) : null;
    const dlRate = progress.download_speed ? fmtBytes(progress.download_speed) + "/s" : "";
    const downloaded = progress.downloaded_bytes != null ? fmtBytes(progress.downloaded_bytes) : "";
    const total = progress.total_bytes != null ? fmtBytes(progress.total_bytes) : "";
    if (pct != null) cells[5].innerHTML = `<div style="width:100%;background:#2a2a2a;border-radius:4px;overflow:hidden;margin-top:4px;"><div style="width:${pct}%;height:6px;background:#4a9eff;transition:width 0.3s;"></div></div><span style="font-size:0.8em;color:#aaa;">${pct}% — ${downloaded}${total ? " / " + total : ""}${dlRate ? " (" + dlRate + ")" : ""}</span>`;
    break;
  }
}

async function copyUid(uid, anchorEl) {
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(uid); ok = true; }
    else throw new Error("clipboard api unavailable");
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = uid; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, 99999); ok = document.execCommand("copy"); document.body.removeChild(ta);
    } catch (e2) { ok = false; }
  }
  toast(ok ? "Listing UID copied to clipboard" : "Failed to copy listing UID", ok ? "success" : "error", anchorEl);
}

async function refreshAuthTab() {
  const d = await api("/api/auth/status");
  if (!d || !d.ok) { $("#authStatusText").textContent = "Status unavailable: " + (d && d.message ? d.message : "unknown error"); return; }
  if (d.authenticated) {
    $("#authStatusText").textContent = "Signed in";
    const fab = d.fab || {};
    $("#authEpicState").textContent = "OK";
    $("#authEpicExpires").textContent = d.expires_at || "—";
    $("#fabSessionState").textContent = fab.session_present ? (fab.needs_refresh ? "Expired / needs refresh" : "OK") : "No Fab session";
    $("#fabSessionDays").textContent = fab.days_remaining != null ? String(fab.days_remaining) : "—";
  } else {
    $("#authStatusText").textContent = "Not signed in";
    $("#authEpicState").textContent = "—"; $("#authEpicExpires").textContent = "—";
    $("#fabSessionState").textContent = "—"; $("#fabSessionDays").textContent = "—";
  }
  let who = { display_name: "—", email: "—" };
  try { const w = await api("/api/auth/whoami"); who = w.data || who; } catch (e) {}
  $("#whoDisplayName").textContent = who.display_name || "—";
  $("#whoEmail").textContent = who.email || "—";
}

async function startLogin() {
  toast("Starting Fab login (browser window should open)…", "info");
  const j = await api("/api/auth/login", { method: "POST", body: { manual: false } });
  watchJob(j.job_id, async (res) => {
    if (res.ok) { toast("Login finished. Checking status…", "info"); await refreshAuthTab(); }
    else toast("Login failed: " + (res.message || "unknown"), "error");
  }, async (err) => toast("Login failed: " + (err.message || "unknown"), "error"));
}

async function doLogout() {
  await api("/api/auth/logout", { method: "POST", body: {} });
  await refreshAuthTab();
  toast("Logged out", "info");
}

function setFilter(key, value) { state.filters[key] = value; saveFilters(); renderResults(); }
function clearFilters() {
  state.filters = { query: "", engine: "", category: "", format: "", platform: "", sort: "latest" };
  setupFilters(); renderResults();
}

async function init() {
  document.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => {
    state.filters.sort = button.dataset.sort;
    document.querySelectorAll("[data-sort]").forEach((tab) => tab.setAttribute("aria-pressed", String(tab === button)));
    saveFilters(); renderResults();
  }));
  $("#librarySearch").addEventListener("input", (event) => setFilter("query", event.target.value));
  [["#engineFilter", "engine"], ["#categoryFilter", "category"], ["#formatFilter", "format"], ["#platformFilter", "platform"]].forEach(([selector, key]) => $(selector).addEventListener("change", (event) => setFilter(key, event.target.value)));
  $("#clearFilters").addEventListener("click", clearFilters);
  $("#btnLogin").addEventListener("click", startLogin); $("#btnLogout").addEventListener("click", doLogout);
  $("#btnHelp").addEventListener("click", () => $("#helpModal").classList.remove("hidden"));
  $("#helpModalClose").addEventListener("click", () => $("#helpModal").classList.add("hidden"));
  $("#resultsGrid").addEventListener("click", async (event) => { const card = event.target.closest(".asset-card"); if (card && card.dataset.uid) await openDownloadModal(card.dataset.uid, card.dataset.title); });
  $("#resultsGrid").addEventListener("contextmenu", (event) => {
    const card = event.target.closest(".asset-card"); if (!card) return; event.preventDefault();
    if (card.dataset.uid) { copyUid(card.dataset.uid, card); card.classList.add("copied"); setTimeout(() => card.classList.remove("copied"), 800); }
  });
  $("#engineModalCancel").addEventListener("click", () => { $("#engineModal").classList.add("hidden"); state.pending = null; });
  $("#engineModalConfirm").addEventListener("click", confirmDownload);
  await loadLibrary();
  try { await refreshAuthTab(); } catch (e) { $("#authStatusText").textContent = "Status unavailable: " + e.message; }
}

document.addEventListener("DOMContentLoaded", init);
