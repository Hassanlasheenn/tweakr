// Tweakr anonymous usage analytics — stored locally only, never transmitted
// All data stays in chrome.storage.local. No network requests. No user IDs.

(function () {
  "use strict";

  const STORAGE_KEY = "tweakr_analytics";

  const defaults = {
    firstUsed: null,
    lastUsed: null,
    totalSessions: 0,
    actions: {
      edit: 0,
      delete: 0,
      style: 0,
      undo: 0,
    },
    features: {
      scopeGlobal: 0,
      scopeLocal: 0,
      addProperty: 0,
      removeProperty: 0,
    },
    frameworks: {},
    dailyActive: {},
  };

  let stats = null;

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function load(callback) {
    if (typeof chrome === "undefined" || !chrome.storage) {
      stats = { ...defaults };
      if (callback) callback();
      return;
    }
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      stats = result[STORAGE_KEY] || { ...defaults };
      // Ensure all keys exist (upgrade from older versions)
      if (!stats.actions) stats.actions = { ...defaults.actions };
      if (!stats.features) stats.features = { ...defaults.features };
      if (!stats.frameworks) stats.frameworks = {};
      if (!stats.dailyActive) stats.dailyActive = {};
      if (callback) callback();
    });
  }

  function save() {
    if (typeof chrome === "undefined" || !chrome.storage || !stats) return;
    chrome.storage.local.set({ [STORAGE_KEY]: stats });
  }

  function trackSession() {
    if (!stats) return;
    const now = new Date().toISOString();
    if (!stats.firstUsed) stats.firstUsed = now;
    stats.lastUsed = now;
    stats.totalSessions++;

    const d = today();
    stats.dailyActive[d] = (stats.dailyActive[d] || 0) + 1;

    // Keep only last 30 days
    const keys = Object.keys(stats.dailyActive).sort();
    while (keys.length > 30) {
      delete stats.dailyActive[keys.shift()];
    }

    save();
  }

  function trackAction(action) {
    if (!stats) return;
    if (stats.actions[action] !== undefined) {
      stats.actions[action]++;
    }
    stats.lastUsed = new Date().toISOString();
    save();
  }

  function trackFeature(feature) {
    if (!stats) return;
    if (stats.features[feature] !== undefined) {
      stats.features[feature]++;
    }
    save();
  }

  function trackFramework(fileExt) {
    if (!stats) return;
    const ext = fileExt.split(".").pop() || "unknown";
    const framework =
      ext === "jsx" || ext === "tsx"
        ? "react"
        : ext === "vue"
          ? "vue"
          : ext === "svelte"
            ? "svelte"
            : ext === "html" || ext === "htm"
              ? "html"
              : "other";
    stats.frameworks[framework] = (stats.frameworks[framework] || 0) + 1;
    save();
  }

  function getStats() {
    return stats ? { ...stats } : null;
  }

  // Initialize on load
  load(() => {
    trackSession();
  });

  globalThis.TweakrAnalytics = {
    trackAction,
    trackFeature,
    trackFramework,
    getStats,
    load,
  };
})();
