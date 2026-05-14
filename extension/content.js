(() => {
  "use strict";

  // --- Analytics (local only, no network) ---
  const analytics = globalThis.TweakrAnalytics || {};
  const track = analytics.trackAction || (() => {});
  const trackFeature = analytics.trackFeature || (() => {});
  const trackFramework = analytics.trackFramework || (() => {});

  // --- Configuration ---
  let SERVER_URL = "http://localhost:3333";
  let WS_URL = "ws://localhost:3333";
  const DEBUG = false;
  function log(...args) {
    if (DEBUG) console.log("[Tweakr]", ...args);
  }

  // Load user-configured server URL from chrome.storage
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({ host: "localhost", port: 3333 }, (cfg) => {
      SERVER_URL = `http://${cfg.host}:${cfg.port}`;
      WS_URL = `ws://${cfg.host}:${cfg.port}`;
    });
  }

  // Clean up previous injection
  if (window.__domSyncActive) {
    const oldTooltip = document.getElementById("dom-sync-tooltip");
    if (oldTooltip) oldTooltip.remove();
    const oldEdit = document.getElementById("dom-sync-inline-edit");
    if (oldEdit) oldEdit.remove();
    const oldToast = document.getElementById("dom-sync-toast");
    if (oldToast) oldToast.remove();
    document.querySelectorAll(".dom-sync-highlight").forEach((el) => {
      el.classList.remove("dom-sync-highlight");
    });
  }
  // Close previous WebSocket connection
  if (window.__domSyncWS) {
    window.__domSyncWS.close();
    window.__domSyncWS = null;
  }
  window.__domSyncActive = true;

  // Reference utilities from content-utils.js
  const {
    rgbToHex,
    cssToCamel,
    isColorProp,
    isIgnoredElement,
    isFormControl,
    ownText,
    canEdit,
    canDelete,
    canStyle,
    canInteract,
  } = globalThis.TweakrUtils || {};

  let ws = null;
  let currentTarget = null;
  let tooltip = null;
  let inlineEdit = null;
  let filePath = "";
  let locked = false; // locks hover when tooltip/edit is active
  let listenerController = null; // AbortController for hover listeners

  // --- WebSocket ---
  function connectWS() {
    ws = new WebSocket(WS_URL);
    window.__domSyncWS = ws;
    ws.onopen = () => log("Connected to bridge server");
    ws.onclose = () => {
      log("Disconnected. Reconnecting in 3s...");
      setTimeout(connectWS, 3000);
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.success) {
          showToast(data.message, "success");
          // Refresh component map so the next action uses updated source state
          refreshComponents();
        } else {
          showToast(data.message || "Operation failed", "error");
        }
      } catch {
        showToast("Invalid server response", "error");
      }
    };
    ws.onerror = (err) => log("WebSocket error:", err.type);
  }
  connectWS();

  // --- Auto-detect file path from server ---
  let componentMap = []; // [{file, elements}]
  let componentsLoaded = false;
  let loadingComponents = false;

  function loadComponents(force = false) {
    if (!force && (componentsLoaded || loadingComponents)) return;
    loadingComponents = true;
    fetch(`${SERVER_URL}/agents/explore`)
      .then((r) => r.json())
      .then((data) => {
        componentMap = data.components || [];
        componentsLoaded = true;
        loadingComponents = false;
        if (componentMap.length === 1) {
          filePath = componentMap[0].file;
        } else if (componentMap.length > 1 && !filePath) {
          filePath = componentMap[0].file;
        }
        log("Loaded", componentMap.length, "components");
      })
      .catch(() => {
        loadingComponents = false;
        log("Server not reachable — retrying in 3s");
        setTimeout(loadComponents, 3000);
      });
  }

  function refreshComponents() {
    componentsLoaded = false;
    loadComponents(true);
  }

  // Fetch on load
  loadComponents();

  // Also trigger when popup injects files (skip if already loaded)
  Object.defineProperty(window, "__domSyncFiles", {
    set() {
      loadComponents();
    },
    get() {
      return componentMap.map((c) => c.file);
    },
    configurable: true,
  });

  // Legacy: support manual file path injection
  if (window.__domSyncFilePath) {
    filePath = window.__domSyncFilePath;
  }
  Object.defineProperty(window, "__domSyncFilePath", {
    set(val) {
      filePath = val;
    },
    get() {
      return filePath;
    },
    configurable: true,
  });

  // Find which file an element belongs to by matching tag+id+class+text
  function detectFileForElement(el) {
    if (componentMap.length === 0) return filePath;
    if (componentMap.length === 1) return componentMap[0].file;

    const tag = el.tagName.toLowerCase();
    const id = el.id || "";

    // Strip Angular/framework runtime classes — they don't exist in source templates
    // and pollute the overlap score, causing utility classes to incorrectly decide the winner.
    const RUNTIME =
      /^(ng-star-inserted|ng-tns-|ng-touched|ng-untouched|ng-pristine|ng-dirty|ng-valid|ng-invalid|ng-pending|ng-submitted|ng-animate-disabled|cdk-)/;
    const classes = Array.from(el.classList).filter(
      (c) => c !== "dom-sync-highlight" && !RUNTIME.test(c)
    );
    const text = (el.textContent || "").trim().slice(0, 100);

    // Specific classes (BEM names with __ or --, long identifiers) are highly discriminating.
    // Generic utility classes (short, no BEM separators) appear in many components.
    const specificClasses = classes.filter(
      (c) => c.includes("__") || c.includes("--") || c.length > 15
    );

    let bestMatch = null;
    let bestScore = 0;

    for (const comp of componentMap) {
      for (const elem of comp.elements) {
        let score = 0;
        if (elem.tag === tag) score += 1;
        if (id && elem.id === id) score += 10;
        if (elem.classes && classes.length) {
          const overlap = classes.filter((c) => elem.classes.includes(c)).length;
          const specificOverlap = specificClasses.filter((c) => elem.classes.includes(c)).length;
          // Specific class matches score 10×; utility class matches score 2×
          score += specificOverlap * 10 + (overlap - specificOverlap) * 2;
          // If DOM element has specific classes but none match this source element, penalise
          if (specificClasses.length > 0 && specificOverlap === 0) score -= 5;
        }
        if (text && elem.text && elem.text.includes(text.slice(0, 30))) score += 5;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = comp.file;
        }
      }
    }

    return bestMatch || filePath || (componentMap[0] && componentMap[0].file) || "";
  }

  // --- Toast ---
  function showToast(message, type) {
    const existing = document.getElementById("dom-sync-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "dom-sync-toast";
    toast.className = type;

    const icon = document.createElement("span");
    icon.style.cssText = "display:flex;align-items:center;flex-shrink:0;";
    if (type === "success") {
      icon.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/></svg>';
    } else {
      icon.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>';
    }
    toast.appendChild(icon);

    const text = document.createElement("span");
    text.textContent = message;
    toast.appendChild(text);

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("hiding");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // --- Build element descriptor ---
  function describeElement(el) {
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      classes: Array.from(el.classList).filter((c) => c !== "dom-sync-highlight"),
      text: (el.textContent || "").trim().slice(0, 200),
      file: detectFileForElement(el),
    };
  }

  // --- Style groups ---
  const STYLE_GROUPS = [
    {
      name: "Spacing",
      props: [
        { css: "padding", jsxKey: "padding", type: "text" },
        { css: "margin", jsxKey: "margin", type: "text" },
      ],
    },
    {
      name: "Typography",
      props: [
        { css: "color", jsxKey: "color", type: "color" },
        { css: "font-size", jsxKey: "fontSize", type: "text" },
        { css: "font-weight", jsxKey: "fontWeight", type: "text" },
      ],
    },
    {
      name: "Background",
      props: [{ css: "background-color", jsxKey: "backgroundColor", type: "color" }],
    },
    {
      name: "Border",
      props: [
        { css: "border", jsxKey: "border", type: "text" },
        { css: "border-radius", jsxKey: "borderRadius", type: "text" },
      ],
    },
  ];

  // Element classification functions are in content-utils.js (TweakrUtils)

  // Detect if element likely has dynamic content (heuristic)
  function isDynamicContent(el) {
    // Check componentMap for dynamic expressions on this element
    const tag = el.tagName.toLowerCase();
    const id = el.id || "";
    const text = (el.textContent || "").trim();

    for (const comp of componentMap) {
      for (const elem of comp.elements) {
        if (elem.tag !== tag) continue;
        if (id && elem.id === id) {
          // Check if the source text differs from DOM text (dynamic)
          if (elem.text && text && elem.text !== text) return true;
        }
      }
    }

    // Heuristic: if text looks like it could be from data (numbers, emails, dates)
    if (/^\d+$/.test(text)) return true;
    if (/\S+@\S+\.\S+/.test(text)) return true;

    return false;
  }

  // canEdit, canDelete, canInteract are from TweakrUtils (content-utils.js)

  function isOwnUI(el) {
    if (!el) return false;
    return !!(
      el.closest("#dom-sync-tooltip") ||
      el.closest("#dom-sync-inline-edit") ||
      el.closest("#dom-sync-toast")
    );
  }

  // --- Tooltip (single instance) ---
  function ensureTooltip() {
    if (tooltip && document.body.contains(tooltip)) return;
    // Remove any stale tooltip from DOM
    const old = document.getElementById("dom-sync-tooltip");
    if (old) old.remove();
    tooltip = document.createElement("div");
    tooltip.id = "dom-sync-tooltip";
    tooltip.setAttribute("role", "toolbar");
    tooltip.setAttribute("aria-label", "Element actions");

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "dom-sync-delete-btn";
    deleteBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
    deleteBtn.title = "Delete element";
    deleteBtn.setAttribute("aria-label", "Delete element");
    deleteBtn.setAttribute("tabindex", "0");

    const editBtn = document.createElement("button");
    editBtn.className = "dom-sync-edit-btn";
    editBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L7 21H3v-4L17 3z"/></svg>';
    editBtn.title = "Edit element";
    editBtn.setAttribute("aria-label", "Edit text");
    editBtn.setAttribute("tabindex", "0");

    const undoBtn = document.createElement("button");
    undoBtn.className = "dom-sync-undo-btn";
    undoBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h6"/><path d="M3 10l4-4"/><path d="M3 10l4 4"/><path d="M9 4a8 8 0 1 1-1 11"/></svg>';
    undoBtn.title = "Undo last change";
    undoBtn.setAttribute("aria-label", "Undo last change");
    undoBtn.setAttribute("tabindex", "0");

    deleteBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleDelete();
    });

    const styleBtn = document.createElement("button");
    styleBtn.className = "dom-sync-style-btn";
    styleBtn.innerHTML =
      "<span style=\"font-family:'SF Mono','Fira Code','JetBrains Mono',monospace;font-size:9px;font-weight:700;letter-spacing:0.5px;line-height:1;\">CSS</span>";
    styleBtn.title = "Edit styles";
    styleBtn.setAttribute("aria-label", "Edit styles");
    styleBtn.setAttribute("tabindex", "0");

    editBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleEdit();
    });

    styleBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleStyleEdit();
    });

    undoBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleUndo();
    });

    tooltip.appendChild(deleteBtn);
    tooltip.appendChild(editBtn);
    tooltip.appendChild(styleBtn);
    tooltip.appendChild(undoBtn);
    tooltip._deleteBtn = deleteBtn;
    tooltip._editBtn = editBtn;
    tooltip._styleBtn = styleBtn;
    tooltip._undoBtn = undoBtn;

    // Keep tooltip alive when hovered
    tooltip.addEventListener("mouseenter", () => {
      locked = true;
    });
    tooltip.addEventListener("mouseleave", () => {
      locked = false;
      hideTooltip();
    });

    document.body.appendChild(tooltip);
  }

  function updateTooltipButtons(el) {
    if (!tooltip) return;
    tooltip._deleteBtn.style.display = canDelete(el) ? "flex" : "none";
    tooltip._editBtn.style.display = canEdit(el) ? "flex" : "none";
    tooltip._styleBtn.style.display = "flex"; // style is always available
    tooltip._undoBtn.style.display = "flex";
  }

  function showTooltipAt(el) {
    ensureTooltip();
    const rect = el.getBoundingClientRect();
    const tw = tooltip.offsetWidth || 120;
    const th = tooltip.offsetHeight || 36;

    // Position above the element, right-aligned, overlapping the top edge
    // The overlap ensures the mouse can move from element to tooltip without gap
    let top = rect.top - th + 4; // 4px overlap into element
    let left = rect.right - tw;

    // If no room above, position below with overlap into bottom edge
    if (top < 2) {
      top = rect.bottom - 4;
    }

    // Keep within viewport
    if (left < 4) left = 4;
    if (left + tw > window.innerWidth - 4) left = window.innerWidth - tw - 4;

    tooltip.style.top = top + window.scrollY + "px";
    tooltip.style.left = left + window.scrollX + "px";
    tooltip.style.display = "flex";
  }

  let hideTimeout = null;

  function scheduleHide() {
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      if (locked) return;
      // Check if mouse is still over tooltip or target
      if (tooltip && tooltip.matches(":hover")) return;
      if (currentTarget && currentTarget.matches(":hover")) return;
      if (tooltip) tooltip.style.display = "none";
      if (currentTarget) {
        currentTarget.classList.remove("dom-sync-highlight");
        currentTarget = null;
      }
    }, 300);
  }

  function hideTooltip() {
    scheduleHide();
  }

  // --- Actions ---
  function showConfirmDialog(message, onConfirm, onCancel) {
    // Backdrop
    const backdrop = document.createElement("div");
    backdrop.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;animation:dom-sync-panel-in 0.15s ease-out;";

    // Dialog box
    const dialog = document.createElement("div");
    dialog.style.cssText =
      "background:rgba(19,19,26,0.95);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:20px 24px;min-width:280px;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;";

    // Message
    const msg = document.createElement("p");
    msg.textContent = message;
    msg.style.cssText = "color:#e0e0e0;font-size:14px;margin:0 0 18px;line-height:1.5;";
    dialog.appendChild(msg);

    // Button row
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:10px;justify-content:flex-end;";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText =
      "padding:8px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;background:rgba(255,255,255,0.06);color:#9ca3af;transition:background 0.15s;";
    cancelBtn.addEventListener("mouseenter", () => {
      cancelBtn.style.background = "rgba(255,255,255,0.1)";
    });
    cancelBtn.addEventListener("mouseleave", () => {
      cancelBtn.style.background = "rgba(255,255,255,0.06)";
    });

    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "Delete";
    confirmBtn.style.cssText =
      "padding:8px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;background:rgba(244,63,94,0.2);color:#fb7185;transition:background 0.15s;";
    confirmBtn.addEventListener("mouseenter", () => {
      confirmBtn.style.background = "rgba(244,63,94,0.35)";
    });
    confirmBtn.addEventListener("mouseleave", () => {
      confirmBtn.style.background = "rgba(244,63,94,0.2)";
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    function cleanup() {
      backdrop.remove();
    }

    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cleanup();
      if (onCancel) onCancel();
    });
    confirmBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cleanup();
      onConfirm();
    });
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        cleanup();
        if (onCancel) onCancel();
      }
    });

    // Hide tooltip while dialog is open
    if (tooltip) tooltip.style.display = "none";

    confirmBtn.focus();
  }

  function handleDelete() {
    if (!currentTarget || !filePath) {
      showToast("No source file detected — check server is running", "error");
      return;
    }
    if (!canDelete(currentTarget)) {
      showToast("This element cannot be deleted", "error");
      return;
    }

    const tag = currentTarget.tagName.toLowerCase();
    const id = currentTarget.id ? `#${currentTarget.id}` : "";
    const text = (currentTarget.textContent || "").trim().slice(0, 30);
    const label = text ? `"${text}"` : `<${tag}${id}>`;

    showConfirmDialog(`Delete ${label} from source code?`, () => {
      const info = describeElement(currentTarget);
      const msg = { action: "delete", ...info };

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
        track("delete");
        trackFramework(info.file || "");
        currentTarget.style.opacity = "0.3";
        currentTarget.style.transition = "opacity 0.3s";
      } else {
        showToast("Not connected to bridge server", "error");
      }
    });
    locked = false;
    hideTooltip();
  }

  function handleEdit() {
    if (!currentTarget || !filePath) {
      showToast("No source file detected — check server is running", "error");
      return;
    }
    if (!canEdit(currentTarget)) {
      showToast("This element cannot be edited", "error");
      return;
    }

    locked = false;
    if (tooltip) tooltip.style.display = "none";
    showInlineEdit(currentTarget);
  }

  function handleUndo() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "undo", file: filePath || "" }));
      track("undo");
    } else {
      showToast("Not connected to bridge server", "error");
    }
    locked = false;
    hideTooltip();
  }

  function handleStyleEdit() {
    if (!currentTarget) {
      showToast("No element selected", "error");
      return;
    }
    locked = false;
    if (tooltip) tooltip.style.display = "none";
    showStylePanel(currentTarget);
  }

  // --- All CSS properties for autocomplete ---
  const ALL_CSS_PROPS = [
    "align-items",
    "align-self",
    "animation",
    "aspect-ratio",
    "backdrop-filter",
    "background",
    "background-color",
    "background-image",
    "background-size",
    "border",
    "border-bottom",
    "border-color",
    "border-left",
    "border-radius",
    "border-right",
    "border-style",
    "border-top",
    "border-width",
    "bottom",
    "box-shadow",
    "box-sizing",
    "color",
    "cursor",
    "display",
    "filter",
    "flex",
    "flex-direction",
    "flex-grow",
    "flex-shrink",
    "flex-wrap",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "gap",
    "grid-template-columns",
    "grid-template-rows",
    "height",
    "justify-content",
    "left",
    "letter-spacing",
    "line-height",
    "list-style",
    "margin",
    "margin-bottom",
    "margin-left",
    "margin-right",
    "margin-top",
    "max-height",
    "max-width",
    "min-height",
    "min-width",
    "object-fit",
    "opacity",
    "outline",
    "overflow",
    "overflow-x",
    "overflow-y",
    "padding",
    "padding-bottom",
    "padding-left",
    "padding-right",
    "padding-top",
    "position",
    "right",
    "row-gap",
    "text-align",
    "text-decoration",
    "text-overflow",
    "text-shadow",
    "text-transform",
    "top",
    "transform",
    "transition",
    "vertical-align",
    "visibility",
    "white-space",
    "width",
    "word-break",
    "word-spacing",
    "z-index",
  ];

  // cssToCamel, isColorProp are from TweakrUtils (content-utils.js)

  // --- Style Panel ---
  function showStylePanel(el) {
    if (inlineEdit) inlineEdit.remove();

    inlineEdit = document.createElement("div");
    inlineEdit.id = "dom-sync-inline-edit";

    const computed = getComputedStyle(el);
    const initialValues = {};
    const inputs = {};
    let customPropsContainer;
    let selectedScope = "global";

    // Helper: create a property row
    function createPropRow(cssProp, jsxKey, type, container) {
      const row = document.createElement("div");
      row.className = "dom-sync-style-row";

      const lbl = document.createElement("span");
      lbl.className = "dom-sync-edit-label";
      lbl.textContent = cssProp;
      row.appendChild(lbl);

      let rawValue = computed.getPropertyValue(cssProp) || "";
      if (cssProp === "border" && !rawValue) {
        const bw = computed.getPropertyValue("border-width") || "0px";
        const bs = computed.getPropertyValue("border-style") || "none";
        const bc = computed.getPropertyValue("border-color") || "";
        rawValue = `${bw} ${bs} ${bc}`.trim();
      }

      if (type === "color") {
        const colorRow = document.createElement("div");
        colorRow.className = "dom-sync-color-row";

        const colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.value = rgbToHex(rawValue);

        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.className = "dom-sync-style-input";
        textInput.value = rgbToHex(rawValue);

        colorInput.addEventListener("input", () => {
          textInput.value = colorInput.value;
          el.style[jsxKey] = colorInput.value;
        });
        textInput.addEventListener("input", () => {
          if (/^#[0-9a-f]{3,8}$/i.test(textInput.value)) {
            const hex = textInput.value;
            // <input type="color"> requires full 6-digit hex — expand #abc → #aabbcc
            const fullHex = /^#[0-9a-f]{3}$/i.test(hex)
              ? "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
              : hex;
            colorInput.value = fullHex;
            el.style[jsxKey] = hex;
          }
        });

        colorRow.appendChild(colorInput);
        colorRow.appendChild(textInput);
        row.appendChild(colorRow);
        initialValues[jsxKey] = rgbToHex(rawValue);
        inputs[jsxKey] = textInput;
      } else {
        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.className = "dom-sync-style-input";
        textInput.value = rawValue;
        textInput.addEventListener("input", () => {
          el.style[jsxKey] = textInput.value;
        });
        row.appendChild(textInput);
        initialValues[jsxKey] = rawValue;
        inputs[jsxKey] = textInput;
      }

      // Remove button
      const removeBtn = document.createElement("button");
      removeBtn.className = "dom-sync-remove-btn";
      removeBtn.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
      removeBtn.title = "Remove property";
      removeBtn.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        el.style[jsxKey] = "";
        delete inputs[jsxKey];
        delete initialValues[jsxKey];
        row.remove();
      });
      row.appendChild(removeBtn);

      container.appendChild(row);
      return row;
    }

    // Container for source rules (populated async)
    const sourceRulesContainer = document.createElement("div");
    sourceRulesContainer.style.cssText = "display:flex;flex-direction:column;gap:10px;";
    inlineEdit.appendChild(sourceRulesContainer);

    // Fetch source CSS rules from server
    const elClasses = Array.from(el.classList).filter((c) => c !== "dom-sync-highlight");
    const queryParams = new URLSearchParams({
      file: detectFileForElement(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      classes: elClasses.join(","),
    });

    // Track scope metadata per selector for the Apply action
    const selectorMeta = {}; // { selector: { file, scope, usedBy } }
    // selectedScope is declared at function scope (line 485)

    // Property categories for organized display
    const PROP_CATEGORIES = [
      {
        label: "Appearance",
        props: [
          "background-color", "background", "background-image", "opacity",
          "border-radius", "border", "border-color", "border-width", "border-style",
          "box-shadow", "outline", "visibility",
        ],
      },
      {
        label: "Layout",
        props: [
          "display", "position", "width", "height", "min-width", "max-width",
          "min-height", "max-height", "padding", "padding-top", "padding-right",
          "padding-bottom", "padding-left", "margin", "margin-top", "margin-right",
          "margin-bottom", "margin-left", "gap", "row-gap", "column-gap",
          "flex-direction", "align-items", "justify-content", "flex-wrap", "flex",
          "align-self", "justify-self", "overflow", "overflow-x", "overflow-y",
          "z-index", "top", "right", "bottom", "left",
        ],
      },
      {
        label: "Typography",
        props: [
          "color", "font-size", "font-weight", "font-family", "line-height",
          "letter-spacing", "text-align", "text-decoration", "text-transform", "white-space",
        ],
      },
    ];
    const propToCategory = new Map();
    for (const cat of PROP_CATEGORIES) {
      for (const p of cat.props) propToCategory.set(p, cat.label);
    }

    // Helper to create a context badge
    function makeBadge(text, color, bg, title) {
      const b = document.createElement("span");
      b.textContent = text;
      b.title = title || "";
      b.style.cssText = `font-size:10px;font-weight:600;letter-spacing:0.3px;padding:2px 8px;border-radius:10px;background:${bg};color:${color};border:1px solid ${color}33;white-space:nowrap;`;
      return b;
    }

    fetch(`${SERVER_URL}/agents/styles?${queryParams}`)
      .then((r) => r.json())
      .then((data) => {
        const { rules, inlineStyles, elementMeta } = data;

        // --- Build merged property map ---
        // cssProp → { value, selector, scope, file, usedBy, isComputed, isShared }
        const propMap = new Map();
        let hasSharedRules = false;

        if (rules) {
          for (const [selector, ruleData] of Object.entries(rules)) {
            if (/:hover|:focus|:active|:visited|::/.test(selector)) continue;
            const props = ruleData.props || ruleData;
            const scope = ruleData.scope || "component";
            const file = ruleData.file || null;
            const usedBy = ruleData.usedBy || [];
            const isShared = scope === "shared" || scope === "global";
            if (isShared) hasSharedRules = true;
            selectorMeta[selector] = { file, scope, usedBy };
            for (const [cssProp, value] of Object.entries(props)) {
              if (!propMap.has(cssProp)) {
                propMap.set(cssProp, { value, selector, scope, file, usedBy, isComputed: false, isShared });
              }
            }
          }
        }

        if (inlineStyles) {
          for (const [jsxKey, value] of Object.entries(inlineStyles)) {
            const cssProp = jsxKey.replace(/([A-Z])/g, "-$1").toLowerCase();
            if (!propMap.has(cssProp)) {
              propMap.set(cssProp, { value, selector: "inline", scope: "inline", file: null, usedBy: [], isComputed: false, isShared: false });
            }
          }
        }

        // Computed fallbacks for key visual properties not found in source rules
        // (e.g. background-color set via compound selector like .parent .child)
        for (const cssProp of ["background-color", "background-image", "border-color", "box-shadow", "opacity"]) {
          if (propMap.has(cssProp)) continue;
          const val = computed.getPropertyValue(cssProp).trim();
          if (!val || val === "none" || val === "1" || val === "rgba(0, 0, 0, 0)" || val === "transparent") continue;
          propMap.set(cssProp, { value: val, selector: "computed", scope: "computed", file: null, usedBy: [], isComputed: true, isShared: false });
        }

        // --- Element context badges ---
        const badgeRow = document.createElement("div");
        badgeRow.style.cssText = "display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;";

        const uniqueFiles = [...new Set([...propMap.values()].filter((p) => p.file).map((p) => p.file))];
        const hasComponent = [...propMap.values()].some((p) => p.scope === "component");
        const sharedCount = hasSharedRules
          ? Math.max(...[...propMap.values()].filter((p) => p.isShared).map((p) => p.usedBy.length), 0)
          : 0;

        if (hasComponent) {
          badgeRow.appendChild(makeBadge("Component", "#a5b4fc", "#1e1b4b",
            `Styles are in this component's own CSS file.\n${uniqueFiles[0] || ""}`));
        }
        if (hasSharedRules) {
          badgeRow.appendChild(makeBadge(
            `⚠ Shared · ${sharedCount} components`,
            "#fbbf24", "#1c1400",
            `This CSS class is shared across ${sharedCount} components.\nEditing it will change the appearance of ALL of them.`
          ));
        }
        if (elementMeta?.isDynamic) {
          badgeRow.appendChild(makeBadge("⚡ Dynamic data", "#60a5fa", "#0c1a2e",
            "This element's content is bound to backend data.\nOnly edit styles here — do not edit the text content."));
        }
        if (elementMeta?.isTranslated) {
          badgeRow.appendChild(makeBadge("🌐 Translated", "#c084fc", "#180a2e",
            "This element's text is a translation key.\nEdit the translation file to change the text, not the source HTML."));
        }
        if (propMap.size === 0) {
          badgeRow.appendChild(makeBadge("No styles detected", "#9ca3af", "#111", ""));
        }
        if (badgeRow.children.length > 0) sourceRulesContainer.appendChild(badgeRow);

        // --- Scope toggle (only when shared rules exist) ---
        if (hasSharedRules) {
          // Warning banner explaining the impact
          const warning = document.createElement("div");
          warning.style.cssText =
            "font-size:11px;color:#fbbf24;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:8px;padding:7px 10px;margin-bottom:10px;line-height:1.5;";
          warning.textContent =
            `⚠ Some styles here are shared across ${sharedCount} components. Choose where to save your changes:`;
          sourceRulesContainer.appendChild(warning);

          const scopeRow = document.createElement("div");
          scopeRow.className = "dom-sync-scope-toggle";
          const globalBtn = document.createElement("button");
          globalBtn.className = "dom-sync-scope-btn active";
          globalBtn.textContent = `All ${sharedCount} components`;
          globalBtn.title = `Save to the shared CSS file — every component using this class will change`;
          const localBtn = document.createElement("button");
          localBtn.className = "dom-sync-scope-btn";
          localBtn.textContent = "This component only";
          localBtn.title = "Add a CSS override in this component's file — other components stay the same";
          globalBtn.addEventListener("click", (e) => { e.stopPropagation(); selectedScope = "global"; globalBtn.classList.add("active"); localBtn.classList.remove("active"); });
          localBtn.addEventListener("click", (e) => { e.stopPropagation(); selectedScope = "local"; localBtn.classList.add("active"); globalBtn.classList.remove("active"); });
          scopeRow.appendChild(globalBtn);
          scopeRow.appendChild(localBtn);
          sourceRulesContainer.appendChild(scopeRow);
        }

        // --- Render props by visual category ---
        if (propMap.size > 0) {
          const byCategory = { Appearance: [], Layout: [], Typography: [], Other: [] };
          for (const [cssProp, meta] of propMap.entries()) {
            const cat = propToCategory.get(cssProp) || "Other";
            byCategory[cat].push([cssProp, meta]);
          }

          for (const { label } of [...PROP_CATEGORIES, { label: "Other" }]) {
            const entries = byCategory[label];
            if (!entries || entries.length === 0) continue;

            const groupEl = document.createElement("div");
            groupEl.className = "dom-sync-style-group";

            const titleRow = document.createElement("div");
            titleRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:2px;";
            const titleSpan = document.createElement("span");
            titleSpan.className = "dom-sync-style-group-title";
            titleSpan.textContent = label;
            titleRow.appendChild(titleSpan);
            groupEl.appendChild(titleRow);

            for (const [cssProp, { value, isComputed, isShared }] of entries) {
              const jsxKey = cssToCamel(cssProp);
              if (inputs[jsxKey]) continue;
              const isColor = isColorProp(cssProp);
              const row = createPropRow(cssProp, jsxKey, isColor ? "color" : "text", groupEl);
              if (inputs[jsxKey]) {
                const isExpression = /^var\(|^calc\(|^env\(|^clamp\(/.test(value);
                if (!isColor || !isExpression) {
                  inputs[jsxKey].value = value;
                  initialValues[jsxKey] = value;
                }
                if (isColor && isExpression) {
                  inputs[jsxKey].title = `Source: ${value}`;
                  const hint = document.createElement("span");
                  hint.style.cssText = "font-size:10px;opacity:0.5;margin-left:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80px;";
                  hint.textContent = value;
                  hint.title = value;
                  if (row) row.insertBefore(hint, row.querySelector(".dom-sync-remove-btn"));
                }
                // Tag computed/shared source inline
                if (isComputed || isShared) {
                  const tag = document.createElement("span");
                  tag.style.cssText = `font-size:9px;font-style:italic;margin-left:2px;color:${isShared ? "#fbbf24" : "#9ca3af"};opacity:0.7;`;
                  if (isComputed) {
                    tag.textContent = "browser-computed";
                    tag.title = "Value comes from a compound CSS selector — edits will be saved to this component's CSS file";
                  } else {
                    tag.textContent = `shared · ${sharedCount} components`;
                    tag.title = `This property is in a shared CSS class used by ${sharedCount} components. Use "This component only" to avoid affecting others.`;
                  }
                  if (row) row.insertBefore(tag, row.querySelector(".dom-sync-remove-btn"));
                }
              }
            }

            sourceRulesContainer.appendChild(groupEl);
          }
        } else {
          // Fallback: show default groups when no styles found at all
          STYLE_GROUPS.forEach((group) => {
            const groupEl = document.createElement("div");
            groupEl.className = "dom-sync-style-group";
            const title = document.createElement("span");
            title.className = "dom-sync-style-group-title";
            title.textContent = group.name;
            groupEl.appendChild(title);
            group.props.forEach((prop) => createPropRow(prop.css, prop.jsxKey, prop.type, groupEl));
            sourceRulesContainer.appendChild(groupEl);
          });
        }
      })
      .catch(() => {
        STYLE_GROUPS.forEach((group) => {
          const groupEl = document.createElement("div");
          groupEl.className = "dom-sync-style-group";
          const title = document.createElement("span");
          title.className = "dom-sync-style-group-title";
          title.textContent = group.name;
          groupEl.appendChild(title);
          group.props.forEach((prop) => createPropRow(prop.css, prop.jsxKey, prop.type, groupEl));
          sourceRulesContainer.appendChild(groupEl);
        });
      });

    // Custom / Add property group
    const customGroup = document.createElement("div");
    customGroup.className = "dom-sync-style-group";

    const customTitle = document.createElement("span");
    customTitle.className = "dom-sync-style-group-title";
    customTitle.textContent = "Add Property";
    customGroup.appendChild(customTitle);

    customPropsContainer = document.createElement("div");
    customPropsContainer.style.cssText = "display:flex;flex-direction:column;gap:6px;";
    customGroup.appendChild(customPropsContainer);

    // Add property input with autocomplete
    const addRow = document.createElement("div");
    addRow.className = "dom-sync-style-row";
    addRow.style.position = "relative";

    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.className = "dom-sync-style-input";
    addInput.placeholder = "Add property...";
    addInput.style.flex = "1";

    const addBtn = document.createElement("button");
    addBtn.className = "dom-sync-save-btn";
    addBtn.textContent = "+";
    addBtn.style.cssText = "padding:6px 10px;font-size:14px;min-width:32px;";

    // Autocomplete dropdown
    const dropdown = document.createElement("div");
    dropdown.style.cssText =
      "position:absolute;top:100%;left:0;right:0;max-height:150px;overflow-y:auto;background:rgba(19,19,26,0.95);border:1px solid rgba(99,102,241,0.2);border-radius:8px;z-index:2147483647;display:none;margin-top:4px;";

    addInput.addEventListener("input", () => {
      const val = addInput.value.trim().toLowerCase();
      dropdown.innerHTML = "";
      if (val.length < 1) {
        dropdown.style.display = "none";
        return;
      }

      const usedKeys = new Set(Object.keys(inputs));
      const matches = ALL_CSS_PROPS.filter(
        (p) => p.includes(val) && !usedKeys.has(cssToCamel(p))
      ).slice(0, 8);

      if (matches.length === 0) {
        dropdown.style.display = "none";
        return;
      }

      matches.forEach((prop) => {
        const item = document.createElement("div");
        item.textContent = prop;
        item.style.cssText =
          "padding:6px 10px;cursor:pointer;font-size:12px;color:#a5b4fc;font-family:'SF Mono','Fira Code',monospace;";
        item.addEventListener("mouseenter", () => {
          item.style.background = "rgba(99,102,241,0.15)";
        });
        item.addEventListener("mouseleave", () => {
          item.style.background = "none";
        });
        item.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          e.preventDefault();
          addProperty(prop);
          addInput.value = "";
          dropdown.style.display = "none";
        });
        dropdown.appendChild(item);
      });
      dropdown.style.display = "block";
    });

    addInput.addEventListener("blur", () => {
      setTimeout(() => {
        dropdown.style.display = "none";
      }, 150);
    });
    addInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && addInput.value.trim()) {
        const val = addInput.value.trim().toLowerCase();
        const match = ALL_CSS_PROPS.find((p) => p === val);
        if (match) {
          addProperty(match);
          addInput.value = "";
          dropdown.style.display = "none";
        } else showToast("Unknown CSS property", "error");
      }
    });

    function addProperty(cssProp) {
      const jsxKey = cssToCamel(cssProp);
      if (inputs[jsxKey]) return; // already exists
      const type = isColorProp(cssProp) ? "color" : "text";
      createPropRow(cssProp, jsxKey, type, customPropsContainer);
    }

    addBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const val = addInput.value.trim().toLowerCase();
      const match = ALL_CSS_PROPS.find((p) => p === val);
      if (match) {
        addProperty(match);
        addInput.value = "";
        dropdown.style.display = "none";
      } else if (val) showToast("Unknown CSS property", "error");
    });

    addRow.appendChild(addInput);
    addRow.appendChild(addBtn);
    addRow.appendChild(dropdown);
    customGroup.appendChild(addRow);
    inlineEdit.appendChild(customGroup);

    // Actions row
    const actions = document.createElement("div");
    actions.className = "dom-sync-style-actions";

    const saveBtn = document.createElement("button");
    saveBtn.className = "dom-sync-save-btn";
    saveBtn.textContent = "Apply";

    const closeBtn = document.createElement("button");
    closeBtn.className = "dom-sync-cancel-btn";
    closeBtn.textContent = "Close";

    actions.appendChild(saveBtn);
    actions.appendChild(closeBtn);
    inlineEdit.appendChild(actions);

    let applyInProgress = false;
    saveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (applyInProgress) return;

      const changedStyles = {};
      for (const [key, input] of Object.entries(inputs)) {
        const newVal = input.value.trim();
        if (newVal && newVal !== initialValues[key]) {
          changedStyles[key] = newVal;
        }
      }

      if (Object.keys(changedStyles).length === 0) {
        showToast("No changes to save", "error");
        return;
      }

      const info = describeElement(el);
      const msg = { action: "edit-style", ...info, styles: changedStyles, scope: selectedScope };

      // If we know the exact file and selector, pass them for precision
      const selectors = Object.keys(selectorMeta);
      if (selectors.length > 0 && selectedScope === "global") {
        const primarySel = selectors[0];
        const meta = selectorMeta[primarySel];
        if (meta && meta.file) {
          msg.targetFile = meta.file;
          msg.targetSelector = primarySel;
        }
      }

      if (ws && ws.readyState === WebSocket.OPEN) {
        applyInProgress = true;
        saveBtn.style.opacity = "0.5";
        saveBtn.style.pointerEvents = "none";
        ws.send(JSON.stringify(msg));
        track("style");
        trackFeature(selectedScope === "local" ? "scopeLocal" : "scopeGlobal");
        trackFramework(info.file || "");
        for (const [key, val] of Object.entries(changedStyles)) {
          initialValues[key] = val;
        }
        // Re-enable after server response (debounce)
        setTimeout(() => {
          applyInProgress = false;
          saveBtn.style.opacity = "";
          saveBtn.style.pointerEvents = "";
        }, 500);
      } else {
        showToast("Not connected to bridge server", "error");
      }
    });

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeInlineEdit();
    });

    document.body.appendChild(inlineEdit);

    // Position below element, scroll into view if needed
    const rect = el.getBoundingClientRect();
    let top = rect.bottom + 8 + window.scrollY;
    let left = Math.max(4, rect.left + window.scrollX);
    if (left + 280 > window.innerWidth) left = window.innerWidth - 284;

    inlineEdit.style.top = top + "px";
    inlineEdit.style.left = left + "px";

    // Scroll panel into view if it's below the viewport
    requestAnimationFrame(() => {
      inlineEdit.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  // --- Inline Edit ---
  function showInlineEdit(el) {
    if (inlineEdit) inlineEdit.remove();

    inlineEdit = document.createElement("div");
    inlineEdit.id = "dom-sync-inline-edit";

    const label = document.createElement("span");
    label.className = "dom-sync-edit-label";
    label.textContent = "Text:";

    const input = document.createElement("input");
    input.type = "text";
    input.value = ownText(el);
    input.placeholder = "New text...";

    const saveBtn = document.createElement("button");
    saveBtn.className = "dom-sync-save-btn";
    saveBtn.textContent = "Save";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "dom-sync-cancel-btn";
    cancelBtn.textContent = "Cancel";

    inlineEdit.appendChild(label);
    inlineEdit.appendChild(input);
    inlineEdit.appendChild(saveBtn);
    inlineEdit.appendChild(cancelBtn);

    const submit = () => {
      const newText = input.value.trim();
      if (!newText) {
        showToast("Text cannot be empty", "error");
        return;
      }
      const info = describeElement(el);
      const msg = { action: "edit", ...info, newText };
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
        track("edit");
        trackFramework(info.file || "");
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
            node.textContent = newText;
            break;
          }
        }
      } else {
        showToast("Not connected to bridge server", "error");
      }
      closeInlineEdit();
    };

    saveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      submit();
    });
    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeInlineEdit();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") closeInlineEdit();
    });

    setTimeout(() => {
      input.focus();
      input.select();
    }, 10);

    document.body.appendChild(inlineEdit);

    // Position below element, scroll into view if needed
    const rect = el.getBoundingClientRect();
    let top = rect.bottom + 8 + window.scrollY;
    let left = Math.max(4, rect.left + window.scrollX);
    if (left + 280 > window.innerWidth) left = window.innerWidth - 284;

    inlineEdit.style.top = top + "px";
    inlineEdit.style.left = left + "px";

    requestAnimationFrame(() => {
      inlineEdit.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function closeInlineEdit() {
    if (inlineEdit) {
      inlineEdit.remove();
      inlineEdit = null;
    }
    if (currentTarget) {
      currentTarget.classList.remove("dom-sync-highlight");
      currentTarget = null;
    }
  }

  // --- Hover handling ---
  // Always create a fresh AbortController so stop() can tear down listeners immediately.
  if (listenerController) listenerController.abort();
  listenerController = new AbortController();
  const { signal } = listenerController;
  window.__domSyncListenersAttached = true;

  document.addEventListener(
    "mouseover",
    (e) => {
      if (!e.target) return;
      if (inlineEdit) return;

      // Mouse entered tooltip — cancel any pending hide
      if (isOwnUI(e.target)) {
        locked = true;
        if (hideTimeout) {
          clearTimeout(hideTimeout);
          hideTimeout = null;
        }
        return;
      }

      if (locked) return;
      if (!canInteract(e.target)) return;

      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }

      if (currentTarget && currentTarget !== e.target) {
        currentTarget.classList.remove("dom-sync-highlight");
      }

      currentTarget = e.target;
      currentTarget.classList.add("dom-sync-highlight");
      updateTooltipButtons(currentTarget);
      showTooltipAt(currentTarget);
    },
    { capture: true, signal }
  );

  document.addEventListener(
    "mouseout",
    (e) => {
      if (inlineEdit) return;

      // Leaving tooltip
      if (isOwnUI(e.target) && !isOwnUI(e.relatedTarget)) {
        locked = false;
        scheduleHide();
        return;
      }

      if (locked) return;
      scheduleHide();
    },
    { capture: true, signal }
  );

  // Click outside to dismiss inline edit
  document.addEventListener(
    "mousedown",
    (e) => {
      if (inlineEdit && !isOwnUI(e.target)) {
        closeInlineEdit();
      }
    },
    { capture: true, signal }
  );

  // --- Respond to popup messages ---
  chrome.runtime?.onMessage?.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "ping") {
      sendResponse({ active: !!window.__domSyncActive });
    } else if (msg.type === "stop") {
      // Remove all hover/click listeners immediately
      if (listenerController) {
        listenerController.abort();
        listenerController = null;
      }
      // Clean up UI
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
      if (tooltip) {
        tooltip.style.display = "none";
      }
      if (currentTarget) {
        currentTarget.classList.remove("dom-sync-highlight");
        currentTarget = null;
      }
      closeInlineEdit();
      const toast = document.getElementById("dom-sync-toast");
      if (toast) toast.remove();
      document.querySelectorAll(".dom-sync-highlight").forEach((el) => {
        el.classList.remove("dom-sync-highlight");
      });
      locked = false;
      if (ws) {
        try {
          ws.close();
        } catch {}
        ws = null;
      }
      if (window.__domSyncWS) {
        try {
          window.__domSyncWS.close();
        } catch {}
        window.__domSyncWS = null;
      }
      window.__domSyncActive = false;
      window.__domSyncListenersAttached = false;
      sendResponse({ stopped: true });
    }
  });

  log("Content script loaded. Hover over elements to inspect.");
})();
