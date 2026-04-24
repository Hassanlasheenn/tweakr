let SERVER_URL = "http://localhost:3333";

// Load user-configured server URL
if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
  chrome.storage.sync.get({ host: "localhost", port: 3333 }, (cfg) => {
    SERVER_URL = `http://${cfg.host}:${cfg.port}`;
  });
}

const statusEl = document.getElementById("status");
const activateBtn = document.getElementById("activate");
const hintEl = document.getElementById("hint");
let detectedFiles = [];

function showActive() {
  activateBtn.classList.add("hidden");
  statusEl.className = "status active";
  statusEl.textContent = "Active";
  hintEl.textContent = "Hover over any element to edit it.";
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
      statusEl.textContent = "No components found in src/";
      activateBtn.disabled = true;
      return;
    }
  } catch {
    statusEl.className = "status offline";
    statusEl.textContent = "Server offline — run: node server.js";
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
  statusEl.textContent = "Ready";
  activateBtn.disabled = false;
}

if (typeof globalThis.__TWEAKR_TEST__ === "undefined") {
  init();
}

// Activate content script on current tab
activateBtn.addEventListener("click", async () => {
  if (detectedFiles.length === 0) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["styles.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content-utils.js", "content.js"],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (files) => {
        window.__domSyncFiles = files;
      },
      args: [detectedFiles],
    });

    showActive();
  } catch {
    statusEl.className = "status offline";
    statusEl.textContent = "Cannot access this page";
  }
});
