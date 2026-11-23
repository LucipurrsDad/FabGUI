"use strict";

// Treat the engine selector as an inclusive upper bound. An asset may support
// newer engines too; for sorting/display use its newest supported version at
// or below the selected cap.
function engineAtOrBelow(asset, cap) {
  const versions = assetVersions(asset);
  if (!cap) return versions[0] || "";
  return versions.filter((version) => compareVersions(version, cap) <= 0)[0] || "";
}

const originalSetupFilters = window.setupFilters;
window.setupFilters = function setupEngineUpToFilters() {
  originalSetupFilters();
  const select = document.querySelector("#engineFilter");
  select.setAttribute("aria-label", "Filter assets by engine version up to the selected version");
  for (const option of select.options) {
    if (!option.value) {
      option.textContent = `Any engine (${state.results.length})`;
      continue;
    }
    const count = state.results.filter((asset) => Boolean(engineAtOrBelow(asset, option.value))).length;
    option.textContent = `Up to ${option.value.replace("UE_", "UE ")} (${count})`;
  }
};

window.latestEngine = function latestEngineAtOrBelow(asset) {
  return engineAtOrBelow(asset, state.filters.engine);
};

window.filteredResults = function filteredResultsByEngineCap() {
  const query = state.filters.query.trim().toLocaleLowerCase();
  return state.results.filter((asset) => {
    const categories = categoryNames(asset);
    const engine = engineAtOrBelow(asset, state.filters.engine);
    const platforms = assetPlatforms(asset, state.filters.engine);
    if (state.filters.engine && !engine) return false;
    if (state.filters.category && !categories.includes(state.filters.category)) return false;
    if (state.filters.format && distributionMethod(asset) !== state.filters.format) return false;
    if (state.filters.platform && !platforms.includes(state.filters.platform)) return false;
    if (query) {
      const haystack = [asset.title, asset.id, listingUid(asset), distributionMethod(asset), categories.join(" "), plainText(asset.description)]
        .join(" ").toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }).sort((a, b) => {
    if (state.filters.sort === "title") {
      return String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" });
    }
    const engineDifference = compareVersions(latestEngine(b) || "0", latestEngine(a) || "0");
    return engineDifference || String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" });
  });
};
