const hostInput = document.getElementById("host");
const portInput = document.getElementById("port");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");

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
