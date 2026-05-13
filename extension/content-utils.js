// Tweakr utility functions — pure, testable, no side effects
// Injected before content.js via chrome.scripting.executeScript

(function () {
  "use strict";

  const IGNORED_TAGS = new Set(["html", "body", "head", "script", "style", "link", "meta"]);
  const FORM_TAGS = new Set(["input", "textarea", "select", "option", "form"]);
  const EDITABLE_TEXT_TAGS = new Set([
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "span",
    "label",
    "a",
    "button",
  ]);
  const DELETABLE_TAGS = new Set([
    "div",
    "section",
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "button",
    "a",
    "span",
    "article",
    "aside",
    "nav",
    "footer",
    "header",
    "main",
    "ul",
    "ol",
    "li",
  ]);

  function rgbToHex(rgb) {
    if (!rgb || rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)") return "#000000";
    const match = rgb.match(/\d+/g);
    if (!match || match.length < 3) return "#000000";
    return (
      "#" +
      match
        .slice(0, 3)
        .map((v) => parseInt(v).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  function cssToCamel(css) {
    return css.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  function isColorProp(css) {
    return /color|background-color|border-color|outline-color/.test(css);
  }

  function isIgnoredElement(el) {
    return IGNORED_TAGS.has(el.tagName.toLowerCase());
  }

  function isFormControl(el) {
    const tag = el.tagName.toLowerCase();
    if (FORM_TAGS.has(tag)) return true;
    if (tag === "button" && el.type === "submit" && el.closest("form")) return true;
    return false;
  }

  function ownText(el) {
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    return text.trim();
  }

  function canEdit(el) {
    if (isIgnoredElement(el) || isFormControl(el)) return false;
    const tag = el.tagName.toLowerCase();
    if (!EDITABLE_TEXT_TAGS.has(tag)) return false;
    if (!ownText(el)) return false;
    return true;
  }

  function canDelete(el) {
    if (isIgnoredElement(el) || isFormControl(el)) return false;
    return DELETABLE_TAGS.has(el.tagName.toLowerCase());
  }

  function canStyle(el) {
    if (isIgnoredElement(el)) return false;
    // Any visible element can be styled
    const tag = el.tagName.toLowerCase();
    if (tag === "#text" || tag === "#comment") return false;
    return true;
  }

  function canInteract(el) {
    return canEdit(el) || canDelete(el) || canStyle(el);
  }

  globalThis.TweakrUtils = {
    IGNORED_TAGS,
    FORM_TAGS,
    EDITABLE_TEXT_TAGS,
    DELETABLE_TAGS,
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
  };
})();
