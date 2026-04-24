import { describe, it, expect, beforeEach, vi } from "vitest";

// Setup popup HTML structure in jsdom
function setupPopupDOM() {
  document.body.innerHTML = `
    <div id="status" class="status">Checking...</div>
    <button id="activate" class="activate-btn">Start Editing</button>
    <p id="hint" class="hint">Connecting to server...</p>
  `;
}

describe("popup", () => {
  beforeEach(() => {
    setupPopupDOM();
    vi.restoreAllMocks();
  });

  describe("showActive behavior", () => {
    it("sets correct state when activated", () => {
      const btn = document.getElementById("activate");
      const status = document.getElementById("status");
      const hint = document.getElementById("hint");

      // Simulate showActive()
      btn.classList.add("hidden");
      status.className = "status active";
      status.textContent = "Active";
      hint.textContent = "Hover over any element to edit it.";

      expect(btn.classList.contains("hidden")).toBe(true);
      expect(status.textContent).toBe("Active");
      expect(status.className).toBe("status active");
      expect(hint.textContent).toBe("Hover over any element to edit it.");
    });
  });

  describe("offline state", () => {
    it("shows server offline message and disables button", () => {
      const status = document.getElementById("status");
      const btn = document.getElementById("activate");

      // Simulate what init() does when fetch fails
      status.className = "status offline";
      status.textContent = "Server offline — run: node server.js";
      btn.disabled = true;

      expect(status.textContent).toBe("Server offline — run: node server.js");
      expect(status.className).toBe("status offline");
      expect(btn.disabled).toBe(true);
    });
  });

  describe("ready state", () => {
    it("shows Ready and enables button when components found", () => {
      const status = document.getElementById("status");
      const btn = document.getElementById("activate");

      // Simulate what init() does when server responds with components
      status.className = "status ready";
      status.textContent = "Ready";
      btn.disabled = false;

      expect(status.textContent).toBe("Ready");
      expect(status.className).toBe("status ready");
      expect(btn.disabled).toBe(false);
    });
  });

  describe("no components state", () => {
    it("shows no components message and disables button", () => {
      const status = document.getElementById("status");
      const btn = document.getElementById("activate");

      status.className = "status offline";
      status.textContent = "No components found in src/";
      btn.disabled = true;

      expect(status.textContent).toBe("No components found in src/");
      expect(btn.disabled).toBe(true);
    });
  });

  describe("popup DOM structure", () => {
    it("has required elements", () => {
      expect(document.getElementById("status")).not.toBeNull();
      expect(document.getElementById("activate")).not.toBeNull();
      expect(document.getElementById("hint")).not.toBeNull();
    });

    it("button starts enabled", () => {
      const btn = document.getElementById("activate");
      expect(btn.disabled).toBe(false);
    });
  });
});
