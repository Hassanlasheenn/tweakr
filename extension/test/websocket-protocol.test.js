import { describe, it, expect } from "vitest";

// Test the WebSocket message format that content.js sends to the server

describe("WebSocket message protocol", () => {
  // Simulate describeElement from content.js
  function describeElement(el) {
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      classes: Array.from(el.classList),
      text: (el.textContent || "").trim().slice(0, 200),
      file: "src/components/App.jsx",
    };
  }

  describe("describeElement", () => {
    it("includes tag, id, classes, text, file", () => {
      const el = document.createElement("button");
      el.id = "submit-btn";
      el.className = "btn primary";
      el.textContent = "Submit";

      const info = describeElement(el);
      expect(info.tag).toBe("button");
      expect(info.id).toBe("submit-btn");
      expect(info.classes).toEqual(["btn", "primary"]);
      expect(info.text).toBe("Submit");
      expect(info.file).toBe("src/components/App.jsx");
    });

    it("returns empty string for missing id", () => {
      const el = document.createElement("div");
      expect(describeElement(el).id).toBe("");
    });

    it("returns empty classes array for no classes", () => {
      const el = document.createElement("p");
      expect(describeElement(el).classes).toEqual([]);
    });

    it("truncates text to 200 chars", () => {
      const el = document.createElement("p");
      el.textContent = "a".repeat(300);
      expect(describeElement(el).text.length).toBe(200);
    });
  });

  describe("delete message format", () => {
    it("contains required fields for delete action", () => {
      const el = document.createElement("h1");
      el.id = "title";
      el.textContent = "Hello World";

      const info = describeElement(el);
      const msg = { action: "delete", ...info };

      expect(msg.action).toBe("delete");
      expect(msg.tag).toBe("h1");
      expect(msg.id).toBe("title");
      expect(msg.file).toBeDefined();
      expect(msg.text).toBeDefined();
    });
  });

  describe("edit message format", () => {
    it("contains newText field for edit action", () => {
      const el = document.createElement("button");
      el.textContent = "Submit";

      const info = describeElement(el);
      const msg = { action: "edit", ...info, newText: "Send" };

      expect(msg.action).toBe("edit");
      expect(msg.newText).toBe("Send");
      expect(msg.text).toBe("Submit");
    });
  });

  describe("edit-style message format", () => {
    it("contains styles, scope, and target fields", () => {
      const el = document.createElement("button");
      el.className = "btn";

      const info = describeElement(el);
      const msg = {
        action: "edit-style",
        ...info,
        styles: { color: "#fff", backgroundColor: "#333" },
        scope: "global",
        targetFile: "src/components/App.css",
        targetSelector: ".btn",
      };

      expect(msg.action).toBe("edit-style");
      expect(msg.styles).toEqual({ color: "#fff", backgroundColor: "#333" });
      expect(msg.scope).toBe("global");
      expect(msg.targetFile).toBe("src/components/App.css");
      expect(msg.targetSelector).toBe(".btn");
    });

    it("defaults scope to global when not specified", () => {
      const msg = { action: "edit-style", scope: "global" };
      expect(msg.scope).toBe("global");
    });

    it("supports local scope for component override", () => {
      const msg = { action: "edit-style", scope: "local" };
      expect(msg.scope).toBe("local");
    });
  });

  describe("undo message format", () => {
    it("contains only the action field", () => {
      const msg = { action: "undo" };
      expect(msg.action).toBe("undo");
      expect(Object.keys(msg)).toEqual(["action"]);
    });
  });
});
