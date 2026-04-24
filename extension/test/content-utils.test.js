import { describe, it, expect } from "vitest";

const { rgbToHex, cssToCamel, isColorProp, isIgnoredElement, isFormControl, canDelete } =
  globalThis.TweakrUtils;

// Helper to create a mock element
function mockEl(tag, opts = {}) {
  const el = document.createElement(tag);
  if (opts.id) el.id = opts.id;
  if (opts.type) el.type = opts.type;
  if (opts.text) el.textContent = opts.text;
  if (opts.parent) opts.parent.appendChild(el);
  return el;
}

describe("rgbToHex", () => {
  it("converts rgb(255, 0, 0) to #ff0000", () => {
    expect(rgbToHex("rgb(255, 0, 0)")).toBe("#ff0000");
  });

  it("converts rgb(0, 128, 255) to #0080ff", () => {
    expect(rgbToHex("rgb(0, 128, 255)")).toBe("#0080ff");
  });

  it("converts rgb(0, 0, 0) to #000000", () => {
    expect(rgbToHex("rgb(0, 0, 0)")).toBe("#000000");
  });

  it("converts rgb(255, 255, 255) to #ffffff", () => {
    expect(rgbToHex("rgb(255, 255, 255)")).toBe("#ffffff");
  });

  it('returns #000000 for "transparent"', () => {
    expect(rgbToHex("transparent")).toBe("#000000");
  });

  it('returns #000000 for "rgba(0, 0, 0, 0)"', () => {
    expect(rgbToHex("rgba(0, 0, 0, 0)")).toBe("#000000");
  });

  it("returns #000000 for null", () => {
    expect(rgbToHex(null)).toBe("#000000");
  });

  it("returns #000000 for undefined", () => {
    expect(rgbToHex(undefined)).toBe("#000000");
  });

  it("returns #000000 for empty string", () => {
    expect(rgbToHex("")).toBe("#000000");
  });

  it("handles rgba with alpha", () => {
    expect(rgbToHex("rgba(255, 128, 0, 0.5)")).toBe("#ff8000");
  });
});

describe("cssToCamel", () => {
  it("converts background-color to backgroundColor", () => {
    expect(cssToCamel("background-color")).toBe("backgroundColor");
  });

  it("converts font-size to fontSize", () => {
    expect(cssToCamel("font-size")).toBe("fontSize");
  });

  it("converts border-top-left-radius to borderTopLeftRadius", () => {
    expect(cssToCamel("border-top-left-radius")).toBe("borderTopLeftRadius");
  });

  it("returns single-word properties unchanged", () => {
    expect(cssToCamel("color")).toBe("color");
    expect(cssToCamel("margin")).toBe("margin");
  });
});

describe("isColorProp", () => {
  it("returns true for color properties", () => {
    expect(isColorProp("color")).toBe(true);
    expect(isColorProp("background-color")).toBe(true);
    expect(isColorProp("border-color")).toBe(true);
    expect(isColorProp("outline-color")).toBe(true);
  });

  it("returns false for non-color properties", () => {
    expect(isColorProp("font-size")).toBe(false);
    expect(isColorProp("margin")).toBe(false);
    expect(isColorProp("padding")).toBe(false);
  });
});

describe("isIgnoredElement", () => {
  it("returns true for structural elements", () => {
    expect(isIgnoredElement(mockEl("html"))).toBe(true);
    expect(isIgnoredElement(mockEl("body"))).toBe(true);
    expect(isIgnoredElement(mockEl("head"))).toBe(true);
    expect(isIgnoredElement(mockEl("script"))).toBe(true);
    expect(isIgnoredElement(mockEl("style"))).toBe(true);
    expect(isIgnoredElement(mockEl("link"))).toBe(true);
    expect(isIgnoredElement(mockEl("meta"))).toBe(true);
  });

  it("returns false for content elements", () => {
    expect(isIgnoredElement(mockEl("div"))).toBe(false);
    expect(isIgnoredElement(mockEl("span"))).toBe(false);
    expect(isIgnoredElement(mockEl("p"))).toBe(false);
    expect(isIgnoredElement(mockEl("h1"))).toBe(false);
    expect(isIgnoredElement(mockEl("button"))).toBe(false);
  });
});

describe("isFormControl", () => {
  it("returns true for form elements", () => {
    expect(isFormControl(mockEl("input"))).toBe(true);
    expect(isFormControl(mockEl("textarea"))).toBe(true);
    expect(isFormControl(mockEl("select"))).toBe(true);
    expect(isFormControl(mockEl("form"))).toBe(true);
  });

  it("returns true for submit button inside form", () => {
    const form = mockEl("form");
    const btn = mockEl("button", { type: "submit", parent: form });
    document.body.appendChild(form);
    expect(isFormControl(btn)).toBe(true);
    form.remove();
  });

  it("returns false for regular button", () => {
    expect(isFormControl(mockEl("button"))).toBe(false);
  });

  it("returns false for non-form elements", () => {
    expect(isFormControl(mockEl("div"))).toBe(false);
    expect(isFormControl(mockEl("span"))).toBe(false);
    expect(isFormControl(mockEl("p"))).toBe(false);
  });
});

describe("canDelete", () => {
  it("returns true for deletable tags", () => {
    expect(canDelete(mockEl("div"))).toBe(true);
    expect(canDelete(mockEl("p"))).toBe(true);
    expect(canDelete(mockEl("h1"))).toBe(true);
    expect(canDelete(mockEl("button"))).toBe(true);
    expect(canDelete(mockEl("span"))).toBe(true);
    expect(canDelete(mockEl("section"))).toBe(true);
    expect(canDelete(mockEl("nav"))).toBe(true);
  });

  it("returns false for non-deletable tags", () => {
    expect(canDelete(mockEl("img"))).toBe(false);
    expect(canDelete(mockEl("table"))).toBe(false);
  });

  it("returns false for ignored elements", () => {
    expect(canDelete(mockEl("html"))).toBe(false);
    expect(canDelete(mockEl("body"))).toBe(false);
    expect(canDelete(mockEl("script"))).toBe(false);
  });

  it("returns false for form controls", () => {
    expect(canDelete(mockEl("input"))).toBe(false);
    expect(canDelete(mockEl("textarea"))).toBe(false);
  });
});
