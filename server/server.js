const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { WebSocketServer } = require("ws");

const PORT = parseInt(process.env.TWEAKR_PORT || process.env.PORT, 10) || 3333;
const LOG_FILE = path.join(__dirname, "changes.log");

// --- File type detection for multi-framework support ---
const SOURCE_EXTENSIONS = /\.(jsx|tsx|vue|svelte|html|htm|js|ts|component\.html)$/;

// Directories to always skip when scanning for source files
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".angular",
  ".next",
  ".nuxt",
  "coverage",
  "__pycache__",
  ".cache",
  "out",
  ".output",
  "public",
  "static",
  "assets",
  "vendor",
  "tmp",
  ".tmp",
  "e2e",
  "cypress",
  "__tests__",
]);

// Detect all relevant source directories dynamically from the project root
function detectSourceDirs(projectRoot) {
  const candidates = ["src", "app", "pages", "components", "views", "features", "modules", "lib"];
  const found = candidates
    .map((name) => path.join(projectRoot, name))
    .filter((dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory());
  // Fall back to scanning from project root if none of the known dirs exist
  return found.length > 0 ? found : [projectRoot];
}

function getFileType(filePath) {
  // Angular component templates: *.component.html
  if (/\.component\.html$/.test(filePath)) return "angular";
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jsx" || ext === ".tsx") return "jsx";
  if (ext === ".vue") return "vue";
  if (ext === ".svelte") return "svelte";
  if (ext === ".html" || ext === ".htm") return "html";
  return "js"; // .js, .ts, etc.
}

function usesClassName(filePath) {
  const type = getFileType(filePath);
  return type === "jsx"; // only JSX uses className=
}

function getClassAttr(filePath) {
  return usesClassName(filePath) ? "className" : "class";
}

function getDynamicExprPattern(filePath) {
  const type = getFileType(filePath);
  if (type === "jsx" || type === "svelte") return /\{([^}]+)\}/g;
  if (type === "angular") return /\{\{([^}]+)\}\}|\[[\w.]+\]="[^"]+"/g;
  if (type === "vue" || type === "html") return /\{\{([^}]+)\}\}/g;
  return /\{([^}]+)\}/g;
}

function addCssImport(source, cssFileName, filePath) {
  const type = getFileType(filePath);
  if (source.includes(cssFileName)) return source; // already imported
  if (type === "html" || type === "htm") {
    // Insert <link> tag before </head> or at top
    const linkTag = `  <link rel="stylesheet" href="${cssFileName}">\n`;
    if (source.includes("</head>")) {
      return source.replace("</head>", `${linkTag}</head>`);
    }
    return linkTag + source;
  }
  // JS/JSX/TSX/Vue/Svelte: ES6 import
  return `import "./${cssFileName}";\n` + source;
}

function getEventHandlerPattern(filePath) {
  const type = getFileType(filePath);
  const patterns = [/\bon[A-Z]\w+=\{/]; // JSX: onClick={...}
  if (type !== "jsx") {
    patterns.push(/\bon\w+=["']/); // HTML: onclick="..."
  }
  if (type === "vue") {
    patterns.push(/@\w+=/); // Vue: @click="..."
    patterns.push(/v-on:\w+=/); // Vue: v-on:click="..."
  }
  if (type === "svelte") {
    patterns.push(/on:\w+=/); // Svelte: on:click={...}
  }
  if (type === "angular") {
    patterns.push(/\(\w+\)="/); // Angular: (click)="handler()"
  }
  return patterns;
}

// Ensure log file exists
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, "");
}

// --- Undo stack ---
const undoStack = []; // [{file, content, action, timestamp}]
const MAX_UNDO = 50;

function saveSnapshot(filePath, relFile, action) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    undoStack.push({
      file: relFile,
      filePath,
      content,
      action,
      timestamp: new Date().toISOString(),
    });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  } catch {}
}

function performUndo() {
  if (undoStack.length === 0) return null;
  const entry = undoStack.pop();
  try {
    fs.writeFileSync(entry.filePath, entry.content, "utf-8");
    return entry;
  } catch (err) {
    return { error: err.message };
  }
}

// --- Logging ---
function logChange(action, file, detail) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${action.toUpperCase()} | ${file} | ${detail}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(line.trim());
}

// --- Test file sync ---
function getTestFilePath(componentFile) {
  const dir = path.dirname(componentFile);
  const ext = path.extname(componentFile);
  const base = path.basename(componentFile, ext);
  // Try common test file patterns
  const candidates = [
    path.join(dir, "__tests__", `${base}.test${ext}`),
    path.join(dir, "__tests__", `${base}.test.tsx`),
    path.join(dir, "__tests__", `${base}.spec${ext}`),
    path.join(dir, `${base}.test${ext}`),
    path.join(dir, `${base}.spec${ext}`),
  ];
  for (const candidate of candidates) {
    const full = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(full)) return { relative: candidate, absolute: full };
  }
  return null;
}

function syncTestFile(action, info, newText) {
  const testFile = getTestFilePath(info.file);
  if (!testFile) return;

  let testSource;
  try {
    testSource = fs.readFileSync(testFile.absolute, "utf-8");
  } catch {
    return;
  }

  const original = testSource;
  const { tag, id, classes, text } = info;

  if (action === "delete") {
    // Remove test blocks that reference the deleted element
    if (id) {
      // Remove lines referencing #id selectors
      testSource = testSource.replace(
        new RegExp(`^.*['"\`]#${escapeRegex(id)}['"\`].*$`, "gm"),
        ""
      );
    }
    if (text) {
      // Remove lines referencing the element's text content
      const shortText = escapeRegex(text.slice(0, 40));
      testSource = testSource.replace(new RegExp(`^.*${shortText}.*$`, "gmi"), "");
    }
    // Remove empty it() blocks left behind
    testSource = testSource.replace(/it\([^)]*,\s*\(\)\s*=>\s*\{\s*\n(\s*\n)*\s*\}\);?\n?/g, "");
    // Clean up multiple blank lines
    testSource = testSource.replace(/\n{3,}/g, "\n\n");
  } else if (action === "edit" && newText) {
    // Update text references in tests
    if (text) {
      // Replace exact text matches in getByText, queryByText, findByText
      const oldText = escapeRegex(text.slice(0, 60));
      testSource = testSource.replace(
        new RegExp(`(getByText|queryByText|findByText)\\(\\s*/${oldText}/i\\s*\\)`, "gi"),
        `$1(/${escapeRegex(newText)}/i)`
      );
      // Replace exact string matches
      testSource = testSource.replace(
        new RegExp(`(getByText|queryByText|findByText)\\(['"]${oldText}['"]\\)`, "gi"),
        `$1('${newText}')`
      );
      // Replace text in getByRole name patterns
      testSource = testSource.replace(
        new RegExp(`name:\\s*/${oldText}/i`, "gi"),
        `name: /${escapeRegex(newText)}/i`
      );
    }
  }

  if (testSource !== original) {
    fs.writeFileSync(testFile.absolute, testSource, "utf-8");
    logChange("test-sync", testFile.relative, `Synced test file after ${action}`);
    console.log(`[Tweakr] Test file synced: ${testFile.relative}`);
  }
}

// --- Action validation ---
const BLOCKED_TAGS = new Set(["input", "textarea", "select", "option", "form"]);

// Returns only the depth-0 text nodes from an HTML fragment (direct text children,
// not content inside nested child elements). Prevents false-positive dynamic-data
// blocks when a container element has {{ }} expressions only in its descendants.
function extractDirectText(html) {
  let depth = 0;
  let text = "";
  let i = 0;
  while (i < html.length) {
    if (html[i] === "<") {
      const gt = html.indexOf(">", i);
      if (gt === -1) break;
      const inner = html.slice(i + 1, gt);
      const isClose = inner.startsWith("/");
      const isSelfClose =
        inner.endsWith("/") ||
        /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(
          inner.split(/[\s>/]/)[0].replace(/^\//, "")
        );
      const isComment = inner.startsWith("!") || inner.startsWith("?");
      if (!isComment) {
        if (isClose) depth = Math.max(0, depth - 1);
        else if (!isSelfClose) depth++;
      }
      i = gt + 1;
    } else {
      if (depth === 0) text += html[i];
      i++;
    }
  }
  return text;
}

function checkDynamicContent(source, info) {
  const match = findMatchingPattern(source, info);
  if (!match || match.type === "self-closing") return { isDynamic: false, expressions: [] };

  // Use match.tag (actual source tag) — info.tag is the DOM tag and may differ
  // (e.g. Angular renders <button> as <a>). Using the wrong closing tag makes the
  // regex span far into the document and capture unrelated {{ }} expressions.
  const tag = match.tag;
  const fullPattern = new RegExp(`${match.opening}>[\\s\\S]*?</${tag}\\s*>`, "s");
  const m = source.match(fullPattern);
  if (!m) return { isDynamic: false, expressions: [] };

  const contentMatch = m[0].match(/>([\s\S]*)<\//);
  if (!contentMatch) return { isDynamic: false, expressions: [] };

  // Only scan direct text nodes — {{ }} inside child elements are not the element's
  // own text content and should not block editing of the element itself.
  const directText = extractDirectText(contentMatch[1]);
  const exprPattern = getDynamicExprPattern(info.file || "");
  const expressions = [];
  let exprMatch;
  while ((exprMatch = exprPattern.exec(directText)) !== null) {
    const expr = (exprMatch[1] || "").trim();
    if (!expr) continue;
    if (expr.includes("=>")) continue;
    if (expr.startsWith("/*")) continue;
    if (expr.startsWith('"') || expr.startsWith("'") || expr.startsWith("`")) continue;
    expressions.push(expr);
  }
  // Also check for Angular/Vue property bindings in the opening tag
  const fileType = getFileType(info.file || "");
  if (fileType === "angular" || fileType === "vue") {
    const openTag = m[0].match(/^<[^>]+>/);
    if (openTag) {
      // Angular: [property]="expr", *ngIf="expr", *ngFor="expr"
      // Vue: :prop="expr", v-if="expr", v-for="expr"
      if (/\[[\w.]+\]="|^\*ng|\sv-(?:if|for|show|model)=/.test(openTag[0])) {
        expressions.push("(bound property)");
      }
    }
  }

  return { isDynamic: expressions.length > 0, expressions };
}

function hasEventHandlers(source, info) {
  const match = findMatchingPattern(source, info);
  if (!match) return false;
  const openPattern = new RegExp(
    match.opening + (match.type === "self-closing" ? "\\s*/>" : ">"),
    "s"
  );
  const m = source.match(openPattern);
  if (!m) return false;
  const patterns = getEventHandlerPattern(info.file || "");
  return patterns.some((p) => p.test(m[0]));
}

function validateAction(action, source, info) {
  const { tag } = info;

  if (BLOCKED_TAGS.has(tag)) {
    return { allowed: false, reason: `Cannot ${action} form elements` };
  }

  // Block deleting submit buttons
  if (tag === "button" && action === "delete") {
    const match = findMatchingPattern(source, info);
    if (match) {
      const openPattern = new RegExp(
        match.opening + (match.type === "self-closing" ? "\\s*/>" : ">"),
        "s"
      );
      const m = source.match(openPattern);
      if (m && /type=["'{]submit["'}]/.test(m[0])) {
        return { allowed: false, reason: "Cannot delete submit buttons" };
      }
    }
  }

  // Block edit/delete on elements with event handlers
  if (action === "delete" || action === "edit") {
    if (hasEventHandlers(source, info)) {
      return { allowed: false, reason: "Cannot modify elements with event handlers" };
    }
  }

  // Block edit/delete on elements with dynamic content
  if (action === "edit" || action === "delete") {
    const { isDynamic, expressions } = checkDynamicContent(source, info);
    if (isDynamic) {
      return { allowed: false, reason: `Contains dynamic data: ${expressions.join(", ")}` };
    }
  }

  return { allowed: true };
}

// --- Element matching ---

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Runtime-only classes injected by frameworks that won't appear in source templates
const RUNTIME_CLASS_RE =
  /^(ng-star-inserted|ng-tns-|ng-trig$|ng-touched$|ng-untouched$|ng-pristine$|ng-dirty$|ng-valid$|ng-invalid$|ng-pending$|ng-submitted$|ng-animate-disabled$|cdk-)/;

function stripRuntimeClasses(classes) {
  return (classes || []).filter((c) => !RUNTIME_CLASS_RE.test(c));
}

/**
 * Build an array of candidate regex patterns to find an element in source code.
 * Returns patterns from most specific to least specific.
 * Supports both JSX (className) and HTML (class) syntax.
 */
function buildCandidatePatterns(info) {
  const { tag, id, text } = info;
  const classes = stripRuntimeClasses(info.classes);
  const patterns = [];

  // Pattern by id (most reliable)
  if (id) {
    patterns.push(
      `<${tag}[^>]*(?:id=["']${escapeRegex(id)}["']|id=\\{["'\`]${escapeRegex(id)}["'\`]\\})[^>]*`
    );
  }

  // Pattern by class(es)
  if (classes && classes.length > 0) {
    // Try matching all classes together
    const allClasses = classes.map((c) => `(?=[^"']*${escapeRegex(c)})`).join("");
    patterns.push(`<${tag}[^>]*class(?:Name)?=["']${allClasses}[^"']*["'][^>]*`);

    // Try matching first class only (less strict)
    if (classes.length > 1) {
      patterns.push(
        `<${tag}[^>]*class(?:Name)?=["'][^"']*${escapeRegex(classes[0])}[^"']*["'][^>]*`
      );
    }
  }

  // Pattern by text content
  if (text) {
    const shortText = escapeRegex(text.slice(0, 60));
    patterns.push(`<${tag}[^>]*>[^<]*${shortText}`);
  }

  // Generic tag fallback — only when element has no classes.
  // With classes present the class-based patterns above (and the tag-agnostic fallback in
  // findMatchingPattern) should find the element; the bare-tag pattern risks matching the
  // wrong element in a wrong file when file detection guessed incorrectly.
  if (!classes || classes.length === 0) {
    patterns.push(`<${tag}[^>]*`);
  }

  return patterns;
}

/**
 * Try each candidate pattern until one matches.
 * Returns { type, opening, tag } — tag is the element tag found in source (may differ from info.tag
 * when Angular/framework renders a component as a different DOM element, e.g. <button> → <a>).
 */
function findMatchingPattern(source, info) {
  const { tag } = info;
  const candidates = buildCandidatePatterns(info);

  for (const opening of candidates) {
    // Try self-closing: <tag ... />
    const selfClosing = new RegExp(`${opening}\\s*/>`, "s");
    if (selfClosing.test(source)) {
      return { type: "self-closing", pattern: selfClosing, opening, tag };
    }

    // Try with closing tag: <tag ...>...</tag>
    const full = new RegExp(`${opening}>`, "s");
    if (full.test(source)) {
      return { type: "full", opening, tag };
    }
  }

  // Tag-agnostic fallback: find element by classes ignoring the DOM tag.
  // Handles cases where Angular/framework renders <button> or <app-x> as <a> in the DOM.
  const strippedClasses = stripRuntimeClasses(info.classes);
  if (strippedClasses && strippedClasses.length > 0) {
    const captureTag = `<([a-zA-Z][a-zA-Z0-9:-]*)`;
    // Try all stripped classes on any tag
    const allClasses = strippedClasses.map((c) => `(?=[^"']*${escapeRegex(c)})`).join("");
    let m = new RegExp(
      `${captureTag}[^>]*class(?:Name)?=["']${allClasses}[^"']*["'][^>]*>`,
      "s"
    ).exec(source);
    if (m) {
      const matchedTag = m[1];
      const opening = `<${matchedTag}[^>]*class(?:Name)?=["']${allClasses}[^"']*["'][^>]*`;
      return { type: "full", opening, tag: matchedTag };
    }
    // Try first class only
    const firstClass = escapeRegex(strippedClasses[0]);
    m = new RegExp(
      `${captureTag}[^>]*class(?:Name)?=["'][^"']*${firstClass}[^"']*["'][^>]*>`,
      "s"
    ).exec(source);
    if (m) {
      const matchedTag = m[1];
      const opening = `<${matchedTag}[^>]*class(?:Name)?=["'][^"']*${firstClass}[^"']*["'][^>]*`;
      return { type: "full", opening, tag: matchedTag };
    }
  }

  return null;
}

/**
 * Find and remove an element (opening tag + content + closing tag) from source.
 */
function deleteElement(source, info) {
  const match = findMatchingPattern(source, info);
  if (!match) return null;

  const tag = match.tag;

  if (match.type === "self-closing") {
    const pattern = new RegExp(`[ \\t]*${match.opening}\\s*/>[\\t ]*\\n?`, "s");
    return source.replace(pattern, "");
  }

  // Full element with closing tag
  const pattern = new RegExp(`[ \\t]*${match.opening}>[\\s\\S]*?</${tag}\\s*>[\\t ]*\\n?`, "s");
  if (pattern.test(source)) {
    return source.replace(pattern, "");
  }

  return null;
}

/**
 * Find an element and update its text content.
 */
function editElement(source, info, newText) {
  const match = findMatchingPattern(source, info);
  if (!match) return null;

  if (match.type === "self-closing") return null; // can't edit text of self-closing

  const tag = match.tag;
  const pattern = new RegExp(`(${match.opening}>)[\\s\\S]*?(</${tag}\\s*>)`, "s");

  if (pattern.test(source)) {
    return source.replace(pattern, `$1${newText}$2`);
  }

  return null;
}

/**
 * Build a human-readable descriptor for the element.
 */
function describeElement(info) {
  let desc = `<${info.tag}`;
  if (info.id) desc += ` id="${info.id}"`;
  if (info.classes && info.classes.length) desc += ` class="${info.classes.join(" ")}"`;
  desc += ">";
  return desc;
}

/**
 * Search all non-TypeScript source files for an element matching info.
 * Used as a fallback when the file provided by the client doesn't contain the element
 * (e.g. detectFileForElement guessed wrong due to dynamic class bindings).
 * Returns { filePath, relPath, source } for the first file where the element is found,
 * or null if not found in any file.
 */
function findFileWithElement(info, skipFilePath) {
  const projectRoot = process.cwd();
  const allFiles = [];
  for (const dir of detectSourceDirs(projectRoot)) {
    findComponents(dir, allFiles);
  }

  // Exclude: already-tried file, plain TS files (not templates), SKIP_DIRS already handled
  const candidates = allFiles
    .filter((f) => f !== skipFilePath && !(/\.ts$/.test(f) && !/\.tsx$/.test(f)))
    .sort((a, b) => {
      // Prefer .component.html, then other .html, then the rest
      const rank = (f) => (f.endsWith(".component.html") ? 0 : /\.html?$/.test(f) ? 1 : 2);
      return rank(a) - rank(b);
    });

  for (const f of candidates) {
    try {
      const src = fs.readFileSync(f, "utf-8");
      if (findMatchingPattern(src, info)) {
        return { filePath: f, relPath: path.relative(projectRoot, f), source: src };
      }
    } catch {
      // unreadable file — skip
    }
  }
  return null;
}

// --- Build test page from source ---
// Auto-detect first source file, fallback to common patterns
function getDefaultSource() {
  const srcDir = path.resolve(process.cwd(), "src");
  if (fs.existsSync(srcDir)) {
    const files = findComponents(srcDir);
    if (files.length > 0) return path.relative(process.cwd(), files[0]);
  }
  // Fallback: check for index.html in project root
  if (fs.existsSync(path.resolve(process.cwd(), "index.html"))) return "index.html";
  return "src/index.html";
}
let DEFAULT_SOURCE = null; // lazy-initialized

function jsxToHtml(jsx) {
  // Strip import/export/function wrapper — extract just the JSX return block
  let html = jsx;

  // Remove import lines
  html = html.replace(/^import\s.*;\s*$/gm, "");
  // Remove function declaration and hooks
  html = html.replace(/^.*function\s+\w+.*\{$/gm, "");
  html = html.replace(/^\s*const\s+\[.*useState.*$/gm, "");
  html = html.replace(/^\s*const\s+\w+\s*=\s*\(.*\)\s*=>\s*\{[\s\S]*?^\s*\};$/gm, "");
  // Extract return(...) content
  const returnMatch = html.match(/return\s*\(\s*([\s\S]*)\s*\);\s*\}?\s*$/m);
  if (returnMatch) {
    html = returnMatch[1];
  }
  // Remove export line
  html = html.replace(/^export\s+default.*$/gm, "");

  // Convert JSX attributes to HTML
  html = html.replace(/className=/g, "class=");
  html = html.replace(/htmlFor=/g, "for=");
  // Convert JSX style={{ ... }} to HTML style="..."
  html = html.replace(/style=\{\{([^}]*)\}\}/g, (_, styleContent) => {
    const cssProps = styleContent
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((prop) => {
        const [key, val] = prop.split(":").map((s) => s.trim());
        // Convert camelCase to kebab-case
        const cssProp = key.replace(/([A-Z])/g, "-$1").toLowerCase();
        // Remove quotes from value
        const cssVal = val.replace(/['"]/g, "");
        return `${cssProp}: ${cssVal}`;
      })
      .join("; ");
    return `style="${cssProps}"`;
  });
  // Remove JSX expressions like {email}, onChange={...}, value={...}, onSubmit={...}
  html = html.replace(/\s+(?:onChange|onSubmit|onClick|value)=\{[^}]*\}/g, "");
  html = html.replace(/\{[a-zA-Z_]\w*\}/g, "");

  return html.trim();
}

function buildPageFromSource() {
  if (!DEFAULT_SOURCE) DEFAULT_SOURCE = getDefaultSource();
  let jsx = "";
  const sourcePath = path.resolve(process.cwd(), DEFAULT_SOURCE);

  try {
    jsx = fs.readFileSync(sourcePath, "utf-8");
  } catch {
    return `<!DOCTYPE html><html><body style="background:#0f0f1a;color:#e0e0e0;padding:40px;font-family:sans-serif">
      <p>Source file not found: ${DEFAULT_SOURCE}</p>
      <p>Start the server from your project root.</p></body></html>`;
  }

  const body = jsxToHtml(jsx);

  return `<!DOCTYPE html>
<html>
<head><title>DOM Sync Test</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, sans-serif; background: #0f0f1a; color: #e0e0e0; padding: 40px; }
  .login-container { max-width: 400px; margin: 0 auto; }
  h1#login-title.heading.primary { font-size: 28px; margin-bottom: 8px; }
  p.subtitle { color: #888; margin-bottom: 24px; }
  .login-form { display: flex; flex-direction: column; gap: 16px; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-group label { font-size: 13px; color: #aaa; }
  .input-field { padding: 10px 12px; border: 1px solid #333; border-radius: 6px; background: #1a1a2e; color: #e0e0e0; font-size: 14px; }
  .btn { padding: 10px 20px; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .btn.primary { background: #4361ee; color: #fff; }
  .btn.secondary { background: #333; color: #aaa; }
  .forgot-link { color: #4361ee; text-decoration: none; font-size: 13px; }
  .login-footer { margin-top: 24px; font-size: 13px; color: #666; }
  .signup-link { color: #4361ee; text-decoration: none; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

// --- Agent helpers ---
function safeExec(cmd) {
  try {
    return execSync(cmd, {
      cwd: process.cwd(),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    return err.stdout || err.message;
  }
}

function findComponents(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      findComponents(full, results);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// --- Shared CSS detection helpers ---

function findAllCssFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      findAllCssFiles(full, results);
    } else if (entry.isFile() && /\.(css|scss)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function findImportedCss(source, componentDir) {
  const imports = [];
  // ES6 import: import "./file.css"
  const importPattern = /import\s+["']([^"']+\.(?:css|scss))["']/g;
  let m;
  while ((m = importPattern.exec(source)) !== null) {
    const resolved = path.resolve(componentDir, m[1]);
    if (fs.existsSync(resolved)) imports.push(resolved);
  }
  // HTML link tag: <link rel="stylesheet" href="file.css">
  const linkPattern = /<link[^>]+href=["']([^"']+\.(?:css|scss))["'][^>]*>/g;
  while ((m = linkPattern.exec(source)) !== null) {
    const resolved = path.resolve(componentDir, m[1]);
    if (fs.existsSync(resolved)) imports.push(resolved);
  }
  // Vue/Svelte <style src="...">
  const styleSrcPattern = /<style[^>]+src=["']([^"']+\.(?:css|scss))["'][^>]*>/g;
  while ((m = styleSrcPattern.exec(source)) !== null) {
    const resolved = path.resolve(componentDir, m[1]);
    if (fs.existsSync(resolved)) imports.push(resolved);
  }
  // Angular @Component({ styleUrls: ['./component.css'] })
  const styleUrlsPattern = /styleUrls\s*:\s*\[([^\]]*)\]/g;
  while ((m = styleUrlsPattern.exec(source)) !== null) {
    const urls = m[1].match(/["']([^"']+)["']/g) || [];
    for (const url of urls) {
      const clean = url.replace(/["']/g, "");
      if (/\.(css|scss)$/.test(clean)) {
        const resolved = path.resolve(componentDir, clean);
        if (fs.existsSync(resolved)) imports.push(resolved);
      }
    }
  }
  // Angular @Component({ styles: [] }) — inline, skip (handled elsewhere)
  return imports;
}

// Finds a CSS/SCSS selector block using balanced-brace counting.
// Returns { headerStart, bodyStart, bodyEnd } or null if not found.
function findCssBlock(cssSource, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headerRe = new RegExp(`${escaped}\\s*\\{`, "g");
  const headerMatch = headerRe.exec(cssSource);
  if (!headerMatch) return null;
  const bodyStart = headerMatch.index + headerMatch[0].length;
  let depth = 1;
  let pos = bodyStart;
  while (pos < cssSource.length && depth > 0) {
    if (cssSource[pos] === "{") depth++;
    else if (cssSource[pos] === "}") depth--;
    pos++;
  }
  return { headerStart: headerMatch.index, bodyStart, bodyEnd: pos - 1 };
}

// Splits a BEM full selector into parent block + & suffix for SCSS nesting lookup.
// '.financial-balances-wrapper__recharge-balance' → { block: '.financial-balances-wrapper', suffix: '__recharge-balance' }
// '.card--active' → { block: '.card', suffix: '--active' }
function splitBemSelector(selector) {
  const cls = selector.startsWith(".") ? selector.slice(1) : null;
  if (!cls) return null;
  const elemIdx = cls.indexOf("__");
  const modIdx = cls.indexOf("--");
  const splitIdx = elemIdx !== -1 && (modIdx === -1 || elemIdx < modIdx) ? elemIdx : modIdx;
  if (splitIdx === -1) return null;
  return { block: "." + cls.slice(0, splitIdx), suffix: cls.slice(splitIdx) };
}

// Like findCssBlock but also resolves SCSS BEM & nesting:
//   .block { &__element { } }  compiles to  .block__element { }
// Tries the flat selector first; if not found, splits on __ or -- and looks
// for &suffix inside the parent block's body.
function findScssBlock(cssSource, selector) {
  const flat = findCssBlock(cssSource, selector);
  if (flat) return flat;

  const bem = splitBemSelector(selector);
  if (!bem) return null;

  const parent = findCssBlock(cssSource, bem.block);
  if (!parent) return null;

  const blockBody = cssSource.slice(parent.bodyStart, parent.bodyEnd);
  const suffixEscaped = bem.suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // &__suffix or &--suffix, optionally followed by whitespace, comma, or {
  // Also handles multi-selector blocks: &__foo,\n  &__bar { }
  const nestedRe = new RegExp(`&${suffixEscaped}(?=[\\s,{])`, "g");
  const nestedMatch = nestedRe.exec(blockBody);
  if (!nestedMatch) return null;

  // Find the { that opens this rule body (skips comma-separated sibling selectors)
  const fromMatch = blockBody.slice(nestedMatch.index);
  const braceIdx = fromMatch.indexOf("{");
  if (braceIdx === -1) return null;

  const offset = parent.bodyStart;
  const nestedBodyStart = offset + nestedMatch.index + braceIdx + 1;
  let depth = 1;
  let pos = nestedBodyStart;
  while (pos < cssSource.length && depth > 0) {
    if (cssSource[pos] === "{") depth++;
    else if (cssSource[pos] === "}") depth--;
    pos++;
  }
  return { headerStart: offset + nestedMatch.index, bodyStart: nestedBodyStart, bodyEnd: pos - 1 };
}

// Extracts only depth-0 declarations from a CSS/SCSS block body, ignoring
// nested rules like &:hover { }, &__element { }, @media { }.
function extractDirectCssDecls(body) {
  let depth = 0;
  let text = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") depth--;
    else if (depth === 0) text += body[i];
  }
  return text;
}

function selectorExistsInCss(cssSource, selector) {
  return findScssBlock(cssSource, selector) !== null;
}

function findSelectorAcrossFiles(selector, allCssFiles) {
  const found = [];
  for (const cssFile of allCssFiles) {
    try {
      const src = fs.readFileSync(cssFile, "utf-8");
      if (selectorExistsInCss(src, selector)) {
        found.push(cssFile);
      }
    } catch {}
  }
  return found;
}

function findComponentsUsingCssFile(cssFilePath, allJsxFiles) {
  const cssRelPaths = [path.basename(cssFilePath), `./${path.basename(cssFilePath)}`];
  const users = [];
  for (const jsxFile of allJsxFiles) {
    try {
      const src = fs.readFileSync(jsxFile, "utf-8");
      for (const rel of cssRelPaths) {
        if (src.includes(rel)) {
          users.push(path.relative(process.cwd(), jsxFile));
          break;
        }
      }
    } catch {}
  }
  return users;
}

function classifyCssFile(cssFilePath) {
  const rel = path.relative(path.resolve(process.cwd(), "src"), cssFilePath);
  // Files in src/ root (index.css, App.css) are global
  if (!rel.includes(path.sep) || rel.startsWith("styles")) return "global";
  return "component";
}

// --- Request-scoped cache for deduplicating file reads and dir walks ---
class RequestCache {
  constructor() {
    this._dirWalks = {};
    this._fileContents = {};
    this._componentCssUsers = {};
  }

  getAllCssFiles() {
    if (!this._dirWalks.css) {
      const dirs = detectSourceDirs(process.cwd());
      this._dirWalks.css = dirs.flatMap((d) => findAllCssFiles(d));
    }
    return this._dirWalks.css;
  }

  getAllJsxFiles() {
    if (!this._dirWalks.jsx) {
      const dirs = detectSourceDirs(process.cwd());
      this._dirWalks.jsx = dirs.flatMap((d) => findComponents(d));
    }
    return this._dirWalks.jsx;
  }

  readFile(filePath) {
    if (!(filePath in this._fileContents)) {
      if (!fs.existsSync(filePath)) return null;
      this._fileContents[filePath] = fs.readFileSync(filePath, "utf-8");
    }
    return this._fileContents[filePath];
  }

  getComponentsUsingCss(cssFilePath, allJsxFiles) {
    if (!(cssFilePath in this._componentCssUsers)) {
      const cssRelPaths = [path.basename(cssFilePath), `./${path.basename(cssFilePath)}`];
      const users = [];
      for (const jsxFile of allJsxFiles) {
        const src = this.readFile(jsxFile);
        if (!src) continue;
        for (const rel of cssRelPaths) {
          if (src.includes(rel)) {
            users.push(path.relative(process.cwd(), jsxFile));
            break;
          }
        }
      }
      this._componentCssUsers[cssFilePath] = users;
    }
    return this._componentCssUsers[cssFilePath];
  }

  invalidateFile(filePath) {
    delete this._fileContents[filePath];
    delete this._componentCssUsers[filePath];
  }
}

function extractElements(source, filePath = "") {
  // Pure TypeScript files (.ts but not .tsx) are Angular/NestJS logic classes, not HTML templates.
  // Scanning them produces false positives from string literals and config objects.
  if (/\.ts$/.test(filePath) && !/\.tsx$/.test(filePath)) return [];

  const elements = [];
  const tagPattern = /<(\w+)([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  let match;
  while ((match = tagPattern.exec(source)) !== null) {
    const tag = match[1];
    const attrs = match[2] || "";
    const content = (match[3] || "").trim();

    // Skip framework component tags (PascalCase), fragments, template wrappers, and Angular directives
    if (
      /^[A-Z]/.test(tag) ||
      tag === "Fragment" ||
      tag === "template" ||
      tag === "script" ||
      tag === "style" ||
      tag === "ng-container" ||
      tag === "ng-template" ||
      tag === "ng-content"
    )
      continue;

    const idMatch = attrs.match(/id=["']([^"']+)["']/);
    const classMatch = attrs.match(/class(?:Name)?=["']([^"']+)["']/);

    const el = { tag };
    if (idMatch) el.id = idMatch[1];
    if (classMatch) el.classes = classMatch[1].split(/\s+/);
    // Get direct text only (no nested tags)
    const textOnly = content.replace(/<[^>]*>/g, "").trim();
    if (textOnly) el.text = textOnly.slice(0, 100);
    el.selfClosing = match[0].endsWith("/>");

    elements.push(el);
  }
  return elements;
}

// --- HTTP Server ---
const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/changes") {
    try {
      const log = fs.readFileSync(LOG_FILE, "utf-8");
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(log || "No changes recorded yet.\n");
    } catch {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("No changes recorded yet.\n");
    }
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    // Read the JSX source file and convert to serveable HTML
    const jsxBody = buildPageFromSource();
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(jsxBody);
    return;
  }

  // --- Agent API Endpoints ---
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /agents/explore — scan components and list elements
  if (req.method === "GET" && url.pathname === "/agents/explore") {
    try {
      const cache = new RequestCache();
      const components = cache.getAllJsxFiles();
      const result = components.map((file) => {
        const relPath = path.relative(process.cwd(), file);
        const source = cache.readFile(file) || "";
        const elements = extractElements(source, relPath);
        return { file: relPath, elements };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ components: result }, null, 2));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /agents/styles?file=src/components/LoginForm.jsx&tag=button&id=submit-btn&classes=btn,primary
  if (req.method === "GET" && url.pathname === "/agents/styles") {
    const componentFile =
      url.searchParams.get("file") || DEFAULT_SOURCE || (DEFAULT_SOURCE = getDefaultSource());
    const tag = url.searchParams.get("tag") || "";
    const id = url.searchParams.get("id") || "";
    const classes = (url.searchParams.get("classes") || "").split(",").filter(Boolean);

    try {
      const cache = new RequestCache();
      const componentPath = path.resolve(process.cwd(), componentFile);
      const ext = path.extname(componentFile);
      const base = path.basename(componentFile, ext);
      const dir = path.dirname(componentPath);

      const allCssFiles = cache.getAllCssFiles();
      const allJsxFiles = cache.getAllJsxFiles();
      const jsxSource = fs.existsSync(componentPath) ? cache.readFile(componentPath) : "";
      const importedCss = jsxSource ? findImportedCss(jsxSource, dir) : [];

      // Build ordered CSS file list: component CSS first, then imports, then global/others
      const componentCssCandidates = [
        path.join(dir, `${base}.css`),
        path.join(dir, `${base}.module.css`),
        path.join(dir, `${base}.scss`),
      ];
      let componentCssFile = null;
      for (const c of componentCssCandidates) {
        if (fs.existsSync(c)) {
          componentCssFile = c;
          break;
        }
      }

      const seen = new Set();
      const orderedCssFiles = [];
      const addUnique = (f) => {
        if (f && !seen.has(f)) {
          seen.add(f);
          orderedCssFiles.push(f);
        }
      };
      if (componentCssFile) addUnique(componentCssFile);
      importedCss.forEach(addUnique);
      allCssFiles.forEach(addUnique);

      function selectorMatchesElement(selector) {
        if (
          id &&
          new RegExp(`#${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[.#:\\s,{]|$)`).test(selector)
        )
          return true;
        for (const cls of classes) {
          const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (new RegExp(`\\.${escaped}(?=[.#:\\s,{]|$)`).test(selector)) return true;
        }
        if (tag && new RegExp(`(^|[\\s,])${tag}([.#:\\s,{]|$)`).test(selector)) return true;
        return false;
      }

      // Build candidate selectors: individual classes (BEM first), then id, then tag.
      // findScssBlock resolves both flat CSS and SCSS & nesting automatically.
      const stylesCandidates = [];
      if (classes.length > 0) {
        // Prefer BEM classes (__ or --) as they are component-specific
        const bemClasses = classes.filter((c) => c.includes("__") || c.includes("--"));
        const otherClasses = classes.filter((c) => !c.includes("__") && !c.includes("--"));
        [...bemClasses, ...otherClasses].forEach((c) => stylesCandidates.push(`.${c}`));
      }
      if (id) stylesCandidates.push(`#${id}`);
      if (tag) stylesCandidates.push(tag);

      // Parse rules: for each candidate, search all CSS files using SCSS-aware block finder.
      const rules = {};
      for (const cssFilePath of orderedCssFiles) {
        const cssSource = cache.readFile(cssFilePath);
        if (!cssSource) continue;
        const cssRelPath = path.relative(process.cwd(), cssFilePath);
        const scope = classifyCssFile(cssFilePath);
        const usedBy = cache.getComponentsUsingCss(cssFilePath, allJsxFiles);

        for (const sel of stylesCandidates) {
          if (rules[sel]) continue; // already found in a higher-priority file
          const block = findScssBlock(cssSource, sel);
          if (!block) continue;

          // Only extract depth-0 declarations (not nested &:hover, &__child rules)
          const body = extractDirectCssDecls(cssSource.slice(block.bodyStart, block.bodyEnd));
          const props = {};
          body.split(";").forEach((decl) => {
            const trimmed = decl.trim();
            if (!trimmed) return;
            const colonIdx = trimmed.indexOf(":");
            if (colonIdx === -1) return;
            const prop = trimmed.slice(0, colonIdx).trim();
            const val = trimmed.slice(colonIdx + 1).trim();
            if (
              prop &&
              val &&
              !prop.startsWith("@") &&
              !prop.startsWith("&") &&
              !prop.startsWith("//")
            ) {
              props[prop] = val;
            }
          });

          if (Object.keys(props).length > 0) {
            rules[sel] = {
              props,
              file: cssRelPath,
              scope: usedBy.length > 1 ? "shared" : scope,
              usedBy,
            };
          }
        }
      }

      // Drop tag-level rules when class/id rules exist (tag rules are global, not element-specific)
      const hasClassOrIdRules = stylesCandidates
        .filter((s) => s.startsWith(".") || s.startsWith("#"))
        .some((sel) => rules[sel]);
      if (hasClassOrIdRules && tag && rules[tag]) {
        delete rules[tag];
      }

      // Check for inline styles in JSX
      let inlineStyles = null;
      if (jsxSource) {
        const info = { tag, id, classes, text: "" };
        const match = findMatchingPattern(jsxSource, info);
        if (match) {
          const openPattern = new RegExp(
            match.opening + (match.type === "self-closing" ? "\\s*/>" : ">"),
            "s"
          );
          const m = jsxSource.match(openPattern);
          if (m) {
            // Parse JSX style={{ }} or HTML style="..."
            const jsxStyleMatch = m[0].match(/style=\{\{([^}]*)\}\}/);
            const htmlStyleMatch = m[0].match(/style=["']([^"']*)["']/);
            const styleMatch = jsxStyleMatch || htmlStyleMatch;
            if (styleMatch) {
              inlineStyles = {};
              const delim = jsxStyleMatch ? "," : ";";
              styleMatch[1].split(delim).forEach((pair) => {
                const colonIdx = pair.indexOf(":");
                if (colonIdx === -1) return;
                const k = pair.slice(0, colonIdx).trim();
                const v = pair
                  .slice(colonIdx + 1)
                  .trim()
                  .replace(/^['"]|['"]$/g, "");
                if (k) inlineStyles[k] = v;
              });
            }
          }
        }
      }

      // Detect element meta: dynamic bindings and translation keys in source
      const elementMeta = { isDynamic: false, isTranslated: false };
      if (jsxSource) {
        const info = { tag, id, classes: classes.filter((c) => !c.startsWith("ng-")), text: "" };
        const match = findMatchingPattern(jsxSource, info);
        if (match) {
          const openIdx = jsxSource.search(
            new RegExp(match.opening.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          );
          if (openIdx !== -1) {
            const snippet = jsxSource.slice(openIdx, Math.min(openIdx + 600, jsxSource.length));
            elementMeta.isDynamic = /\{\{[^}]+\}\}|\[[\w.]+\]=|\*ngFor|\*ngIf|\basync\b/.test(
              snippet
            );
            elementMeta.isTranslated = /\|\s*translate|\btransloco\b|\bi18n\b|translate="/.test(
              snippet
            );
          }
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            cssFile: componentCssFile ? path.relative(process.cwd(), componentCssFile) : null,
            rules,
            inlineStyles,
            elementMeta,
          },
          null,
          2
        )
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /agents/review — show pending git changes
  if (req.method === "GET" && url.pathname === "/agents/review") {
    try {
      const status = safeExec("git status --short");
      const diff = safeExec("git diff");
      const staged = safeExec("git diff --staged");
      const log = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf-8") : "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            status: status.split("\n").filter(Boolean),
            diff,
            staged,
            changeLog: log.split("\n").filter(Boolean),
          },
          null,
          2
        )
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /agents/commit — stage and commit changes
  if (req.method === "POST" && url.pathname === "/agents/commit") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { files, message } = JSON.parse(body);
        if (!message) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing commit message" }));
          return;
        }

        // Stage files (or all if not specified)
        const filesToStage =
          files && files.length > 0 ? files.map((f) => `"${f}"`).join(" ") : "-A";
        safeExec(`git add ${filesToStage}`);

        // Commit
        const commitMsg = message.replace(/"/g, '\\"');
        const result = safeExec(`git commit -m "${commitMsg}"`);

        // Get the commit hash
        const hash = safeExec("git rev-parse --short HEAD").trim();
        const logEntry = safeExec("git log --oneline -1").trim();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify(
            {
              success: true,
              hash,
              log: logEntry,
              output: result,
            },
            null,
            2
          )
        );
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // GET /agents/plan — get current state for planning
  if (req.method === "GET" && url.pathname === "/agents/plan") {
    const targetFile =
      url.searchParams.get("file") || DEFAULT_SOURCE || (DEFAULT_SOURCE = getDefaultSource());
    const filePath = path.resolve(process.cwd(), targetFile);
    try {
      const source = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null;
      const diff = safeExec(`git diff -- "${targetFile}"`);
      const log = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf-8") : "";

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            file: targetFile,
            exists: !!source,
            source: source,
            pendingDiff: diff || null,
            recentChanges: log.split("\n").filter(Boolean).slice(-10),
          },
          null,
          2
        )
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found\n");
});

// --- WebSocket Server ---
const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  console.log("[DOM Sync] Client connected");

  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      socket.send(JSON.stringify({ success: false, message: "Invalid JSON" }));
      return;
    }

    const { action, file } = msg;

    if (!action || !file) {
      socket.send(
        JSON.stringify({
          success: false,
          message: "Missing action or file field",
        })
      );
      return;
    }

    // Resolve file path relative to CWD
    const filePath = path.resolve(process.cwd(), file);

    // Security: prevent path traversal outside CWD
    if (!filePath.startsWith(process.cwd())) {
      socket.send(
        JSON.stringify({ success: false, message: "File path outside project directory" })
      );
      return;
    }

    if (!fs.existsSync(filePath)) {
      socket.send(JSON.stringify({ success: false, message: `File not found: ${file}` }));
      return;
    }

    // Refuse edits to plain TypeScript files — they are Angular/framework logic, not templates.
    // If this fires, the file-detection heuristic sent us here by mistake.
    if (/\.ts$/.test(file) && !/\.tsx$/.test(file)) {
      socket.send(
        JSON.stringify({
          success: false,
          message: `Cannot edit TypeScript source (${file}). Tweakr edits HTML templates — refresh the page and try again.`,
        })
      );
      return;
    }

    let source;
    try {
      source = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      socket.send(JSON.stringify({ success: false, message: `Cannot read file: ${err.message}` }));
      return;
    }

    // If the element is not in the hinted file, search the whole project.
    // detectFileForElement is a best-guess heuristic; dynamic class bindings ([ngClass], etc.)
    // mean the correct file may not score highest.  We try the hint first (fast path) and only
    // scan other files when the match fails (slow path).
    let effectiveFilePath = filePath;
    let effectiveFile = file;
    let effectiveSource = source;

    if (!findMatchingPattern(source, msg)) {
      const found = findFileWithElement(msg, filePath);
      if (found) {
        effectiveFilePath = found.filePath;
        effectiveFile = found.relPath;
        effectiveSource = found.source;
      }
      // If found === null the per-action blocks below will produce the appropriate error.
    }

    // Make the resolved file available to action-level helpers (e.g. validateAction → getDynamicExprPattern)
    const effectiveMsg = { ...msg, file: effectiveFile };
    const desc = describeElement(msg);

    // Validate action is allowed
    const validation = validateAction(action, effectiveSource, effectiveMsg);
    if (!validation.allowed) {
      socket.send(JSON.stringify({ success: false, message: validation.reason }));
      return;
    }

    if (action === "delete") {
      const result = deleteElement(effectiveSource, effectiveMsg);
      if (result === null) {
        socket.send(
          JSON.stringify({
            success: false,
            message: `Could not find ${desc} in any project file`,
          })
        );
        return;
      }

      saveSnapshot(effectiveFilePath, effectiveFile, "delete");
      fs.writeFileSync(effectiveFilePath, result, "utf-8");
      logChange("delete", effectiveFile, `Deleted ${desc}`);
      syncTestFile("delete", effectiveMsg);
      socket.send(JSON.stringify({ success: true, message: "Deleted successfully!" }));
    } else if (action === "edit") {
      const { newText } = msg;
      if (!newText) {
        socket.send(JSON.stringify({ success: false, message: "Missing newText field" }));
        return;
      }

      const result = editElement(effectiveSource, effectiveMsg, newText);
      if (result === null) {
        socket.send(
          JSON.stringify({
            success: false,
            message: `Could not find ${desc} in any project file`,
          })
        );
        return;
      }

      saveSnapshot(effectiveFilePath, effectiveFile, "edit");
      fs.writeFileSync(effectiveFilePath, result, "utf-8");
      logChange("edit", effectiveFile, `Edited ${desc} -> "${newText}"`);
      syncTestFile("edit", effectiveMsg, newText);
      socket.send(
        JSON.stringify({
          success: true,
          message: "Edited successfully!",
        })
      );
    } else if (action === "edit-style") {
      const { styles } = msg;
      if (!styles || typeof styles !== "object" || Object.keys(styles).length === 0) {
        socket.send(JSON.stringify({ success: false, message: "Missing or empty styles field" }));
        return;
      }

      const match = findMatchingPattern(effectiveSource, effectiveMsg);
      if (!match) {
        socket.send(
          JSON.stringify({
            success: false,
            message: `Could not find ${desc} in any project file`,
          })
        );
        return;
      }

      // --- Scope-aware CSS-first approach (with request-scoped cache) ---

      const cache = new RequestCache();

      function camelToKebab(str) {
        return str.replace(/([A-Z])/g, "-$1").toLowerCase();
      }

      const ext = path.extname(effectiveFile);
      const base = path.basename(effectiveFile, ext);
      const dir = path.dirname(effectiveFilePath);

      const editScope = msg.scope || "global";

      const allCssFiles = cache.getAllCssFiles();
      const allJsxFiles = cache.getAllJsxFiles();

      // Resolve the component's own CSS file
      const componentCssCandidates = [
        path.join(dir, `${base}.css`),
        path.join(dir, `${base}.module.css`),
        path.join(dir, `${base}.scss`),
      ];
      let componentCssFile = null;
      for (const c of componentCssCandidates) {
        if (fs.existsSync(c)) {
          componentCssFile = c;
          break;
        }
      }

      const elClasses = msg.classes || [];
      const elId = msg.id || "";
      const elTag = msg.tag || "";

      let targetSelector = null;
      let cssFilePath = null;
      let cssSource = "";

      // If client tells us which file and selector to target, use that —
      // but only when the element was found in the file the client expected.
      // If effectiveFile differs, msg.targetFile comes from the wrong component's CSS.
      if (msg.targetFile && msg.targetSelector && effectiveFile === file) {
        const resolved = path.resolve(process.cwd(), msg.targetFile);
        if (fs.existsSync(resolved)) {
          cssFilePath = resolved;
          cssSource = cache.readFile(resolved) || "";
          targetSelector = msg.targetSelector;
        }
      }

      // Otherwise, search across all CSS files for matching selectors
      if (!targetSelector) {
        const candidateSelectors = [];
        if (elClasses.length > 0) {
          candidateSelectors.push(elClasses.map((c) => `.${c}`).join(""));
          elClasses.forEach((c) => candidateSelectors.push(`.${c}`));
        }
        if (elId) candidateSelectors.push(`#${elId}`);

        // Priority: component's own CSS first, then others
        const orderedFiles = [];
        if (componentCssFile) orderedFiles.push(componentCssFile);
        allCssFiles.forEach((f) => {
          if (f !== componentCssFile) orderedFiles.push(f);
        });

        for (const sel of candidateSelectors) {
          for (const cssFile of orderedFiles) {
            try {
              const src = cache.readFile(cssFile);
              if (!src) continue;
              if (selectorExistsInCss(src, sel)) {
                const fileScope = classifyCssFile(cssFile);
                const usedBy = cache.getComponentsUsingCss(cssFile, allJsxFiles);
                const isShared = usedBy.length > 1 || fileScope === "global";

                if (isShared && editScope === "local") {
                  break; // fall through to create local override
                }
                targetSelector = sel;
                cssFilePath = cssFile;
                cssSource = src;
                break;
              }
            } catch {}
          }
          if (targetSelector) break;
        }
      }

      // Redirect to component CSS when: nothing found at all, or scope=local on a shared file.
      if (!cssFilePath || (editScope === "local" && cssFilePath !== componentCssFile)) {
        if (!componentCssFile) {
          componentCssFile = path.join(dir, `${base}.css`);
          cssSource = "";
          effectiveSource = addCssImport(effectiveSource, `${base}.css`, effectiveFile);
        } else {
          cssSource = cache.readFile(componentCssFile) || "";
        }
        cssFilePath = componentCssFile;
      }

      // Pick the best selector from the element's own existing classes/id.
      // Never create a new class or modify the HTML — use what's already there.
      if (!targetSelector) {
        const sourceClasses = stripRuntimeClasses(elClasses);
        if (sourceClasses.length > 0) {
          // Prefer BEM-style classes (contain __ or --) — they are component-specific.
          // Fall back to the longest class, which tends to be the most specific.
          const best =
            sourceClasses.find((c) => c.includes("__") || c.includes("--")) ||
            sourceClasses.reduce((a, b) => (a.length >= b.length ? a : b));
          targetSelector = `.${best}`;
        } else if (elId) {
          targetSelector = `#${elId}`;
        } else {
          targetSelector = elTag || "element";
        }
      }

      const cssRelPath = path.relative(process.cwd(), cssFilePath);

      // Save snapshots before writing
      saveSnapshot(effectiveFilePath, effectiveFile, "edit-style");
      saveSnapshot(cssFilePath, cssRelPath, "edit-style-css");

      // Write CSS properties to the target selector
      const cssPropsToWrite = Object.entries(styles)
        .map(([jsxKey, value]) => `  ${camelToKebab(jsxKey)}: ${value};`)
        .join("\n");

      // Use balanced-brace matching so SCSS nested rules (&:hover, &:focus, @media)
      // inside the selector block don't corrupt the file.
      const cssBlock = findScssBlock(cssSource, targetSelector);
      if (cssBlock) {
        let blockBody = cssSource.slice(cssBlock.bodyStart, cssBlock.bodyEnd);
        for (const [jsxKey, value] of Object.entries(styles)) {
          const cssProp = camelToKebab(jsxKey);
          const propPattern = new RegExp(`(\\s*)${cssProp.replace(/[-]/g, "\\-")}\\s*:[^;]*;`, "s");
          if (propPattern.test(blockBody)) {
            blockBody = blockBody.replace(propPattern, `$1${cssProp}: ${value};`);
          } else {
            blockBody = blockBody.trimEnd() + `\n  ${cssProp}: ${value};\n`;
          }
        }
        cssSource =
          cssSource.slice(0, cssBlock.bodyStart) + blockBody + cssSource.slice(cssBlock.bodyEnd);
      } else {
        cssSource = cssSource.trimEnd() + `\n\n${targetSelector} {\n${cssPropsToWrite}\n}\n`;
      }

      // Write files and invalidate cache
      fs.writeFileSync(cssFilePath, cssSource, "utf-8");
      fs.writeFileSync(effectiveFilePath, effectiveSource, "utf-8");
      cache.invalidateFile(cssFilePath);
      cache.invalidateFile(effectiveFilePath);

      const scopeLabel = editScope === "local" ? " (local override)" : "";
      const styleDesc = Object.entries(styles)
        .map(([k, v]) => `${camelToKebab(k)}: ${v}`)
        .join(", ");
      logChange("edit-style", cssRelPath, `${targetSelector} { ${styleDesc} }${scopeLabel}`);
      socket.send(
        JSON.stringify({
          success: true,
          message: `Styled ${targetSelector}${scopeLabel}`,
        })
      );
    } else if (action === "undo") {
      const entry = performUndo();
      if (!entry) {
        socket.send(JSON.stringify({ success: false, message: "Nothing to undo" }));
      } else if (entry.error) {
        socket.send(JSON.stringify({ success: false, message: entry.error }));
      } else {
        logChange("undo", entry.file, `Reverted ${entry.action}`);
        socket.send(JSON.stringify({ success: true, message: "Undone!" }));
      }
    } else {
      socket.send(
        JSON.stringify({
          success: false,
          message: `Unknown action: ${action}`,
        })
      );
    }
  });

  socket.on("close", () => {
    console.log("[DOM Sync] Client disconnected");
  });
});

server.listen(PORT, () => {
  console.log(`\n  DOM Sync Bridge Server`);
  console.log(`  ----------------------`);
  console.log(`  HTTP:      http://localhost:${PORT}`);
  console.log(`  WebSocket: ws://localhost:${PORT}`);
  console.log(`  Changes:   http://localhost:${PORT}/changes`);
  console.log(`  CWD:       ${process.cwd()}\n`);
});
