/* Card clicks open the asset download dialog. The liquidGL renderer can
   cover its target with a canvas in some browsers. Capture clicks before the
   renderer/app handlers and stop the event from being swallowed or doubled. */
(function () {
  "use strict";
  function slugify(value) {
    return String(value || "fab-asset").normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "fab-asset";
  }
  window.slugify = slugify;

  document.addEventListener("click", (event) => {
    const card = event.target.closest && event.target.closest("#resultsGrid .asset-card");
    if (!card || !card.dataset.uid) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    if (typeof window.openDownloadModal === "function") window.openDownloadModal(card.dataset.uid, card.dataset.title || "");
    else if (typeof window.toast === "function") window.toast("Download dialog is unavailable. Refresh and try again.", "error");
  }, true);

  document.addEventListener("click", (event) => {
    if (event.target.id !== "engineModalConfirm") return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    startDownload().catch((error) => {
      const button = document.querySelector("#engineModalConfirm");
      if (button) button.disabled = false;
      if (typeof window.toast === "function") window.toast(`Download failed: ${error.message}`, "error");
    });
  }, true);

  async function startDownload() {
    const currentState = window.state;
    if (!currentState || !currentState.pending) return;
    const pending = currentState.pending;
    const button = document.querySelector("#engineModalConfirm");
    if (button) button.disabled = true;
    try {
      const health = await window.api("/api/health");
      const base = String(health.download_dir || "").replace(/\/+$/, "");
      const outputDir = `${base}/${slugify(pending.title || pending.uid)}`;
      const body = {
        uid: pending.uid,
        output_dir: outputDir,
        engine: document.querySelector("#engineSelect").value,
        platform: document.querySelector("#downloadPlatformSelect").value,
      };
      const response = await window.api("/api/download", { method: "POST", body });
      if (!response || !response.ok) throw new Error((response && response.message) || "Could not start download");
      document.querySelector("#engineModal").classList.add("hidden");
      currentState.pending = null;
      if (button) button.disabled = false;
      if (typeof window.toast === "function") window.toast(`Download started in ${outputDir}…`, "info");
      if (!response.job_id) return;
      if (typeof window.openEventSource === "function") window.openEventSource(response.job_id, (progress) => window.updateJobProgress(response.job_id, progress));
      if (typeof window.watchJob === "function") {
        window.watchJob(response.job_id, (result) => {
          if (result && result.ok) window.toast(`Download complete: ${result.data.files} files, ${window.fmtBytes(result.data.total_bytes)}`, "success");
          else window.toast(`Download failed: ${(result && result.message) || "unknown"}`, "error");
        }, (error) => window.toast(`Download failed: ${(error && error.message) || "unknown"}`, "error"));
      }
    } catch (error) {
      if (button) button.disabled = false;
      throw error;
    }
  }
})();
