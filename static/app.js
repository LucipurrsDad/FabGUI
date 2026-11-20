"use strict";

const state = {
  results: [],
  pending: null,
};

const $ = (s) => document.querySelector(s);

/* ---------------------------------------------------------------- api */

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null;
  try { j = await res.json(); } catch (e) { j = null; }
  if (!res.ok) {
    throw new Error((j && j.message) || (j && j.error && j.error.message) || "Request failed");
  }
  return j;
}

/* ---------------------------------------------------------------- utils */

function esc(s) {
  return String(s == null ? "" : s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");
}

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let i = -1;
  let out = v;
  do { out /= 1024; i++; } while (out >= 1024 && i < units.length - 1);
  return `${out.toFixed(out < 10 ? 2 : 1)} ${units[i]}`;
}

function slugify(s) {
  const slug = String(s || "asset")
  .toLowerCase()
  .trim()
  .replace(/[^a-z-0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");
  return slug || "asset";
}

function priceInfo(r) {
  const sp = r.startingPrice || r.starting_price || null;
  const price = Number(sp && sp.price != null ? sp.price : 0) || 0;
  const disc = Number(sp && sp.discountedPrice != null ? sp.discountedPrice : 0) || 0;
  const currency = (sp && sp.currencyCode) || (sp && sp.currency_code) || "USD";
  const free = r.isFree === true || price === 0 || disc === 0;
  const effective = free ? 0 : (disc || price);
  const label = free ? "Free" : `${currency} ${effective.toFixed(2)}`;
  return { free, label };
}

function toast(msg, kind, anchorEl) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.className = "toast " + (kind || "info") + " show";
  t.style.opacity = "";
  t.style.display = "";
  t.style.transform = "";
  t.style.transition = "";

  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    // Force layout so offsetWidth/Height are current
    void t.offsetWidth;
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
  if (kind !== "error") {
    toast._timer = setTimeout(() => { t.classList.remove("show"); }, 5000);
  }
}

/* ---------------------------------------------------------------- jobs */

const jobWatchers = {};
const jobEventSources = {};

function watchJob(jid, onSuccess, onError) {
  if (jobWatchers[jid]) return;
  let alive = true;
  let timer = null;
  const tick = async () => {
    if (!alive) return;
    try {
      const j = await api(`/api/jobs/${jid}`);
      if (j.state === "success") {
        alive = false;
        clearTimeout(timer);
        closeEventSource(jid);
        if (onSuccess) onSuccess(j.result);
        return;
      }
      if (j.state === "error") {
        alive = false;
        clearTimeout(timer);
        closeEventSource(jid);
        if (onError) onError(j.result || j.error);
        return;
      }
      timer = setTimeout(tick, 2000);
    } catch (e) {
      timer = setTimeout(tick, 3000);
    }
  };
  timer = setTimeout(tick, 1200);
  jobWatchers[jid] = () => {
    alive = false;
    clearTimeout(timer);
    closeEventSource(jid);
  };
}

function closeEventSource(jid) {
  if (jobEventSources[jid]) {
    jobEventSources[jid].close();
    delete jobEventSources[jid];
  }
}

function openEventSource(jid, onProgress) {
  closeEventSource(jid);
  const es = new EventSource(`/api/jobs/${jid}/progress`);
  jobEventSources[jid] = es;
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (onProgress) onProgress(data);
    } catch (e) {}
  };
  es.onerror = () => {
    // EventSource will auto-reconnect; do nothing
  };
}

function getAssetEngines(r) {
  const engines = new Set();
  const versions = r.projectVersions || [];
  versions.forEach((pv) => {
    (pv.engineVersions || []).forEach((e) => engines.add(e));
    (pv.buildVersions || []).forEach((b) => { if (b && b.build_version) engines.add(b.build_version); });
  });
  return engines;
}

function getEngineForAsset(r) {
  const engines = getAssetEngines(r);
  if (engines.has("UE_5.8")) return "UE_5.8";
  if (engines.has("UE_5.7")) {
    toast("Defaulted to UE 5.7 for " + (r.title || "asset") + " - check engines", "info");
    return "UE_5.7";
  }
  return "UE_5.8";
}

function isUE58Compatible(r) {
  return getAssetEngines(r).has("UE_5.8");
}

/* ---------------------------------------------------------------- results (claimed library) */

async function loadLibrary() {
  $("#resultsLoading").classList.remove("hidden");
  try {
    const j = await api("/api/library");
    state.results = (j.data && j.data.results) || [];
    state.results.forEach((r) => { r.owned = true; });
    state.results.sort((a, b) => {
      const a58 = isUE58Compatible(a) ? 0 : 1;
      const b58 = isUE58Compatible(b) ? 0 : 1;
      if (a58 !== b58) return a58 - b58;
      return String(a.title || "").toLowerCase().localeCompare(String(b.title || "").toLowerCase());
    });
    renderResults();
  } catch (e) {
    toast("Failed to load library: " + e.message, "error");
  } finally {
    $("#resultsLoading").classList.add("hidden");
  }
}

function renderResults() {
  const wrap = $("#resultsGrid");
  const empty = $("#resultsEmpty");
  const loading = $("#resultsLoading");
  if (!state.results.length) { wrap.classList.add("hidden"); empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  if (!loading.classList.contains("hidden")) loading.classList.add("hidden");
  wrap.classList.remove("hidden");

  // Build HTML with separator between 5.8 and non-5.8 assets
  let html = "";
  let separatorAdded = false;
  state.results.forEach((r) => {
    const is58 = isUE58Compatible(r);
    if (!separatorAdded && !is58) {
      html += `<div class="asset-separator">Other engines (click to download, toast shows engine used)</div>`;
      separatorAdded = true;
    }
    html += rowHtml(r);
  });
  wrap.innerHTML = html;
  $("#resultCount").textContent = state.results.length ? `${state.results.length} result(s)` : "";
}

function libraryUid(r) {
  const ca = r.customAttributes || [];
  const list = Array.isArray(ca) ? ca : [ca];
  for (const a of list) {
    const v = a && (a.ListingIdentifier || a.listingIdentifier);
    if (v) return v;
  }
  return null;
}

function assetImage(r) {
  for (const key of ['thumbnail', 'thumbnailUrl', 'thumbnail_url', 'coverImage', 'cover_image', 'image', 'icon', 'previewImage', 'preview_image', 'bannerImage', 'posterImage']) {
    if (r[key]) return r[key];
  }
  const media = r.media || r.assets || r.images || r.screenshots;
  if (Array.isArray(media) && media.length) {
    const first = media[0];
    if (typeof first === 'string') return first;
    if (first && (first.url || first.thumbnail || first.image)) return first.url || first.thumbnail || first.image;
  }
  return null;
}

function rowHtml(r) {
  const uid = r.uid || r.listing_uid || r.id || libraryUid(r) || "";
  const title = r.title || "Untitled";
  const img = assetImage(r);
  const imgCell = img
    ? `<img src="${esc(img)}" class="asset-card-img" alt="${esc(title)}" loading="lazy">`
    : `<div class="asset-card-placeholder">–</div>`;
  return `
  <div class="asset-card" data-uid="${esc(uid)}" data-title="${esc(title)}">
  ${imgCell}
  <div class="asset-card-body">
  <div class="asset-card-title">${esc(title)}</div>
  </div>
  </div>`;
}

/* ---------------------------------------------------------------- download */

async function openDownloadModal(uid, title) {
  state.pending = { uid, title };
  $("#engineModalTitle").textContent = title || uid;
  $("#engineModalDir").textContent = slugify(title || uid);
  $("#engineModalBody").classList.add("hidden");
  $("#engineModal").classList.remove("hidden");
}

async function confirmDownload() {
  const p = state.pending;
  if (!p) return;

  const asset = state.results.find((r) => (r.uid || r.listing_uid || r.id || libraryUid(r)) === p.uid);
  const engine = asset ? getEngineForAsset(asset) : "UE_5.8";

  const body = {
    uid: p.uid,
    output_dir: "/home/deck/Downloads",
    engine: engine,
    platform: "Windows",
    jobs: 8,
  };

  const j = await api("/api/download", { method: "POST", body: body });

  $("#engineModal").classList.add("hidden");
  state.pending = null;

  if (!j.ok) {
    toast("Download failed: " + (j.message || "unknown"), "error");
    return;
  }

  toast("Download started…", "info");

  const jid = j.job_id;
  if (!jid) {
    toast("No job ID returned", "error");
    return;
  }

  openEventSource(jid, (progress) => {
    updateJobProgress(jid, progress);
  });

  watchJob(jid, async (res) => {
    if (res.ok) {
      toast(`Download complete: ${res.data.files} files, ${fmtBytes(res.data.total_bytes)}`, "success");
    } else {
      toast("Download failed: " + (res.message || "unknown"), "error");
    }
  }, async (err) => {
    toast("Download failed: " + (err.message || "unknown"), "error");
  });
}

function updateJobProgress(jid, progress) {
  const body = $("#jobsBody");
  if (!body) return;
  const rows = body.querySelectorAll("tr");
  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 2) continue;
    if (cells[0].textContent === jid) {
      const pct = progress.percent != null ? Math.round(progress.percent) : null;
      const dlRate = progress.download_speed ? fmtBytes(progress.download_speed) + "/s" : "";
      const downloaded = progress.downloaded_bytes != null ? fmtBytes(progress.downloaded_bytes) : "";
      const total = progress.total_bytes != null ? fmtBytes(progress.total_bytes) : "";
      const detailCell = cells[5];

      let barHtml = "";
      if (pct != null) {
        barHtml = `<div style="width:100%;background:#2a2a2a;border-radius:4px;overflow:hidden;margin-top:4px;">
        <div style="width:${pct}%;height:6px;background:#4a9eff;transition:width 0.3s;"></div>
        </div>
        <span style="font-size:0.8em;color:#aaa;">${pct}% — ${downloaded}${total ? ' / ' + total : ''}${dlRate ? ' (' + dlRate + ')' : ''}</span>`;
      }
      detailCell.innerHTML = barHtml;
      break;
    }
  }
}

/* ---------------------------------------------------------------- clipboard */

async function copyUid(uid, anchorEl) {
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(uid);
      ok = true;
    } else {
      throw new Error("clipboard api unavailable");
    }
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = uid;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, 99999);
      ok = document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e2) {
      ok = false;
    }
  }
  if (ok) {
    toast("UID copied to clipboard", "success", anchorEl);
  } else {
    toast("Failed to copy UID", "error", anchorEl);
  }
}

/* ---------------------------------------------------------------- auth */

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
    $("#authEpicState").textContent = "—";
    $("#authEpicExpires").textContent = "—";
    $("#fabSessionState").textContent = "—";
    $("#fabSessionDays").textContent = "—";
  }
  let who = { display_name: "—", email: "—" };
  try { const w = await api("/api/auth/whoami"); who = w.data || who; } catch (e) {}
  $("#whoDisplayName").textContent = who.display_name || "—";
  $("#whoEmail").textContent = who.email || "—";
}

async function startLogin() {
  toast("Starting Fab login (browser window should open)…", "info");
  const j = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ manual: false }) });
  watchJob(j.job_id, async (res) => {
    if (res.ok) { toast("Login finished. Checking status…", "info"); await refreshAuthTab(); }
    else { toast("Login failed: " + (res.message || "unknown"), "error"); }
  }, async (err) => { toast("Login failed: " + (err.message || "unknown"), "error"); });
}

async function doLogout() {
  await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
  await refreshAuthTab();
  toast("Logged out", "info");
}

/* ---------------------------------------------------------------- init */

async function init() {
  await loadLibrary();
  await refreshAuthTab();
  $("#btnLogin").addEventListener("click", startLogin);
  $("#btnLogout").addEventListener("click", doLogout);
  $("#btnHelp").addEventListener("click", () => { $("#helpModal").classList.remove("hidden"); });
  $("#helpModalClose").addEventListener("click", () => { $("#helpModal").classList.add("hidden"); });
  $("#resultsGrid").addEventListener("click", async (e) => {
    const card = e.target.closest(".asset-card");
    if (!card) return;
    const uid = card.dataset.uid; const title = card.dataset.title;
    if (uid) await openDownloadModal(uid, title);
  });
  $("#resultsGrid").addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const card = e.target.closest(".asset-card");
    if (!card) return;
    const uid = card.dataset.uid;
    if (uid) {
      copyUid(uid, card);
      card.classList.add("copied");
      setTimeout(() => card.classList.remove("copied"), 800);
    }
  });
  $("#engineModalCancel").addEventListener("click", () => { $("#engineModal").classList.add("hidden"); state.pending = null; });
  $("#engineModalConfirm").addEventListener("click", confirmDownload);
}

document.addEventListener("DOMContentLoaded", init);
