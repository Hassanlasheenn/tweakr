let SERVER_URL = "http://localhost:3333";

function _launchInit() {
  if (typeof globalThis.__TWEAKR_TEST__ === "undefined") {
    init();
  }
}

// Resolve SERVER_URL from storage before calling init() to avoid race condition
if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
  chrome.storage.sync.get({ host: "localhost", port: 3333 }, (cfg) => {
    SERVER_URL = `http://${cfg.host}:${cfg.port}`;
    _launchInit();
  });
} else {
  _launchInit();
}

const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("status-text");
const activateBtn = document.getElementById("activate");
const stopBtn = document.getElementById("stop");
const hintEl = document.getElementById("hint");
let detectedFiles = [];

function showActive() {
  activateBtn.classList.add("hidden");
  stopBtn.classList.add("visible");
  statusEl.className = "status active";
  statusTextEl.textContent = "Active";
  hintEl.textContent = "Hover over any element to edit it.";
}

function showReady() {
  activateBtn.classList.remove("hidden");
  activateBtn.disabled = false;
  stopBtn.classList.remove("visible");
  statusEl.className = "status ready";
  statusTextEl.textContent = "Ready";
  hintEl.textContent = "Hover over any element to edit or remove it from your source code.";
}

// Check server and detect if already active on current tab
async function init() {
  // 1. Check server
  try {
    const res = await fetch(`${SERVER_URL}/agents/explore`);
    if (!res.ok) throw new Error();

    const data = await res.json();
    detectedFiles = (data.components || []).map((c) => c.file);

    if (detectedFiles.length === 0) {
      statusEl.className = "status offline";
      statusTextEl.textContent = "No components found in src/";
      activateBtn.disabled = true;
      return;
    }
  } catch {
    statusEl.className = "status offline";
    statusTextEl.textContent = "Server offline — run: npx tweakr";
    activateBtn.disabled = true;
    return;
  }

  // 2. Check if content script is already running on this tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "ping" });
      if (response && response.active) {
        showActive();
        return;
      }
    } catch {
      // Content script not injected yet — show Start Editing
    }
  }

  // 3. Show ready state
  statusEl.className = "status ready";
  statusTextEl.textContent = "Ready";
  activateBtn.disabled = false;
}

// Stop Tweakr on current tab
stopBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "stop" });
  } catch {
    // content script may already be gone
  }
  showReady();
});

// Activate content script on current tab
activateBtn.addEventListener("click", async () => {
  if (detectedFiles.length === 0) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  if (!tab.url || !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(tab.url)) {
    statusEl.className = "status offline";
    statusTextEl.textContent = "Navigate to your localhost app first";
    return;
  }
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["styles.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["analytics.js", "content-utils.js", "content.js"],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (files) => {
        window.__domSyncFiles = files;
      },
      args: [detectedFiles],
    });

    showActive();
  } catch (err) {
    statusEl.className = "status offline";
    console.error("[Tweakr] Injection failed:", err);
    const msg = err?.message || err?.toString?.() || String(err) || "";
    statusTextEl.textContent =
      msg && msg !== "Error" ? msg : "Injection failed — check popup DevTools console";
  }
});
