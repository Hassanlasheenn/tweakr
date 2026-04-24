const hostInput = document.getElementById("host");
const portInput = document.getElementById("port");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const statsEl = document.getElementById("stats");

// Load saved settings
chrome.storage.sync.get({ host: "localhost", port: 3333 }, (cfg) => {
  hostInput.value = cfg.host;
  portInput.value = cfg.port;
});

saveBtn.addEventListener("click", () => {
  const host = hostInput.value.trim() || "localhost";
  const port = parseInt(portInput.value, 10) || 3333;

  chrome.storage.sync.set({ host, port }, () => {
    statusEl.classList.add("show");
    setTimeout(() => statusEl.classList.remove("show"), 2000);
  });
});

// Load and display usage stats
chrome.storage.local.get("tweakr_analytics", (result) => {
  const s = result.tweakr_analytics;
  if (!s) {
    statsEl.textContent = "No usage data yet. Start editing to see stats.";
    return;
  }

  const actions = s.actions || {};
  const features = s.features || {};
  const frameworks = s.frameworks || {};
  const totalActions = Object.values(actions).reduce((a, b) => a + b, 0);

  const lines = [
    `Sessions:        ${s.totalSessions || 0}`,
    `First used:      ${s.firstUsed ? s.firstUsed.slice(0, 10) : "—"}`,
    `Last used:       ${s.lastUsed ? s.lastUsed.slice(0, 10) : "—"}`,
    ``,
    `Total actions:   ${totalActions}`,
    `  Edit text:     ${actions.edit || 0}`,
    `  Delete:        ${actions.delete || 0}`,
    `  CSS style:     ${actions.style || 0}`,
    `  Undo:          ${actions.undo || 0}`,
    ``,
    `Scope usage:`,
    `  Global:        ${features.scopeGlobal || 0}`,
    `  Local:         ${features.scopeLocal || 0}`,
  ];

  const fwKeys = Object.keys(frameworks);
  if (fwKeys.length > 0) {
    lines.push(``, `Frameworks:`);
    for (const [fw, count] of Object.entries(frameworks)) {
      lines.push(`  ${fw}: ${count}`);
    }
  }

  statsEl.textContent = lines.join("\n");
});
