const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { WebSocketServer } = require("ws");

const PORT = 3333;
const LOG_FILE = path.join(__dirname, "changes.log");

// --- File type detection for multi-framework support ---
const SOURCE_EXTENSIONS = /\.(jsx|tsx|vue|svelte|html|htm|js|ts|component\.html)$/;

function getFileType(filePath) {
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

function checkDynamicContent(source, info) {
  const { tag } = info;
  const match = findMatchingPattern(source, info);
  if (!match || match.type === "self-closing") return { isDynamic: false, expressions: [] };

  const fullPattern = new RegExp(`${match.opening}>[\\s\\S]*?</${tag}>`, "s");
  const m = source.match(fullPattern);
  if (!m) return { isDynamic: false, expressions: [] };

  const contentMatch = m[0].match(/>([\s\S]*)<\//);
  if (!contentMatch) return { isDynamic: false, expressions: [] };

  const content = contentMatch[1];
  const exprPattern = getDynamicExprPattern(info.file || "");
  const expressions = [];
  let exprMatch;
  while ((exprMatch = exprPattern.exec(content)) !== null) {
    const expr = exprMatch[1].trim();
    if (expr.includes("=>")) continue;
    if (expr.startsWith("/*")) continue;
    if (expr.startsWith('"') || expr.startsWith("'") || expr.startsWith("`")) continue;
    expressions.push(expr);
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

/**
 * Build an array of candidate regex patterns to find an element in source code.
 * Returns patterns from most specific to least specific.
 * Supports both JSX (className) and HTML (class) syntax.
 */
function buildCandidatePatterns(info) {
  const { tag, id, classes, text } = info;
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

  // Most generic — just the tag
  patterns.push(`<${tag}[^>]*`);

  return patterns;
}

/**
 * Try each candidate pattern until one matches.
 * Returns { openPattern, selfClosing, full } regex strings.
 */
function findMatchingPattern(source, info) {
  const { tag } = info;
  const candidates = buildCandidatePatterns(info);

  for (const opening of candidates) {
    // Try self-closing: <tag ... />
    const selfClosing = new RegExp(`${opening}\\s*/>`, "s");
    if (selfClosing.test(source)) {
      return { type: "self-closing", pattern: selfClosing, opening };
    }

    // Try with closing tag: <tag ...>...</tag>
    const full = new RegExp(`${opening}>`, "s");
    if (full.test(source)) {
      return { type: "full", opening };
    }
  }

  return null;
}

/**
 * Find and remove an element (opening tag + content + closing tag) from source.
 */
function deleteElement(source, info) {
  const { tag } = info;
  const match = findMatchingPattern(source, info);
  if (!match) return null;

  if (match.type === "self-closing") {
    const pattern = new RegExp(`[ \\t]*${match.opening}\\s*/>[\\t ]*\\n?`, "s");
    return source.replace(pattern, "");
  }

  // Full element with closing tag
  const pattern = new RegExp(`[ \\t]*${match.opening}>[\\s\\S]*?</${tag}>[\\t ]*\\n?`, "s");
  if (pattern.test(source)) {
    return source.replace(pattern, "");
  }

  return null;
}

/**
 * Find an element and update its text content.
 */
function editElement(source, info, newText) {
  const { tag } = info;
  const match = findMatchingPattern(source, info);
  if (!match) return null;

  if (match.type === "self-closing") return null; // can't edit text of self-closing

  const pattern = new RegExp(`(${match.opening}>)[\\s\\S]*?(</${tag}>)`, "s");

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
    if (entry.isDirectory() && entry.name !== "node_modules") {
      findComponents(full, results);
    } else if (SOURCE_EXTENSIONS.test(entry.name)) {
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
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "__tests__") {
      findAllCssFiles(full, results);
    } else if (/\.(css|scss)$/.test(entry.name)) {
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
  return imports;
}

function selectorExistsInCss(cssSource, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{`).test(cssSource);
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

  getAllCssFiles(srcDir) {
    if (!this._dirWalks.css) {
      this._dirWalks.css = findAllCssFiles(srcDir);
    }
    return this._dirWalks.css;
  }

  getAllJsxFiles(srcDir) {
    if (!this._dirWalks.jsx) {
      this._dirWalks.jsx = findComponents(srcDir);
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

function extractElements(source) {
  const elements = [];
  const tagPattern = /<(\w+)([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  let match;
  while ((match = tagPattern.exec(source)) !== null) {
    const tag = match[1];
    const attrs = match[2] || "";
    const content = (match[3] || "").trim();

    // Skip framework component tags (PascalCase), fragments, and template wrappers
    if (
      /^[A-Z]/.test(tag) ||
      tag === "Fragment" ||
      tag === "template" ||
      tag === "script" ||
      tag === "style"
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
    const srcDir = path.resolve(process.cwd(), "src");
    try {
      const cache = new RequestCache();
      const components = cache.getAllJsxFiles(srcDir);
      const result = components.map((file) => {
        const relPath = path.relative(process.cwd(), file);
        const source = cache.readFile(file) || "";
        const elements = extractElements(source);
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

      const srcDir = path.resolve(process.cwd(), "src");
      const allCssFiles = cache.getAllCssFiles(srcDir);
      const allJsxFiles = cache.getAllJsxFiles(srcDir);
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

      // Parse rules across all CSS files (each file read exactly once via cache)
      const rules = {};
      for (const cssFilePath of orderedCssFiles) {
        let cssSource;
        cssSource = cache.readFile(cssFilePath);
        if (!cssSource) continue;
        const cssRelPath = path.relative(process.cwd(), cssFilePath);
        const scope = classifyCssFile(cssFilePath);
        const usedBy = cache.getComponentsUsingCss(cssFilePath, allJsxFiles);

        const rulePattern = /([^{}]+)\{([^}]*)\}/g;
        let ruleMatch;
        while ((ruleMatch = rulePattern.exec(cssSource)) !== null) {
          const selector = ruleMatch[1].trim();
          const body = ruleMatch[2].trim();
          if (!body || !selectorMatchesElement(selector)) continue;

          const props = {};
          body.split(";").forEach((decl) => {
            const colonIdx = decl.indexOf(":");
            if (colonIdx === -1) return;
            const prop = decl.slice(0, colonIdx).trim();
            const val = decl.slice(colonIdx + 1).trim();
            if (prop && val && !prop.startsWith("@") && !prop.startsWith("&")) {
              props[prop] = val;
            }
          });

          if (Object.keys(props).length > 0) {
            const key = selector;
            rules[key] = {
              props,
              file: cssRelPath,
              scope: usedBy.length > 1 ? "shared" : scope,
              usedBy,
            };
          }
        }
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

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            cssFile: componentCssFile ? path.relative(process.cwd(), componentCssFile) : null,
            rules,
            inlineStyles,
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

    let source;
    try {
      source = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      socket.send(JSON.stringify({ success: false, message: `Cannot read file: ${err.message}` }));
      return;
    }

    const desc = describeElement(msg);

    // Validate action is allowed
    const validation = validateAction(action, source, msg);
    if (!validation.allowed) {
      socket.send(JSON.stringify({ success: false, message: validation.reason }));
      return;
    }

    if (action === "delete") {
      const result = deleteElement(source, msg);
      if (result === null) {
        socket.send(
          JSON.stringify({
            success: false,
            message: `Could not find ${desc} in ${file}`,
          })
        );
        return;
      }

      saveSnapshot(filePath, file, "delete");
      fs.writeFileSync(filePath, result, "utf-8");
      logChange("delete", file, `Deleted ${desc}`);
      syncTestFile("delete", msg);
      socket.send(JSON.stringify({ success: true, message: "Deleted successfully!" }));
    } else if (action === "edit") {
      const { newText } = msg;
      if (!newText) {
        socket.send(JSON.stringify({ success: false, message: "Missing newText field" }));
        return;
      }

      const result = editElement(source, msg, newText);
      if (result === null) {
        socket.send(
          JSON.stringify({
            success: false,
            message: `Could not find ${desc} in ${file}`,
          })
        );
        return;
      }

      saveSnapshot(filePath, file, "edit");
      fs.writeFileSync(filePath, result, "utf-8");
      logChange("edit", file, `Edited ${desc} -> "${newText}"`);
      syncTestFile("edit", msg, newText);
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

      const match = findMatchingPattern(source, msg);
      if (!match) {
        socket.send(
          JSON.stringify({
            success: false,
            message: `Could not find ${desc} in ${file}`,
          })
        );
        return;
      }

      // --- Scope-aware CSS-first approach (with request-scoped cache) ---

      const cache = new RequestCache();

      function camelToKebab(str) {
        return str.replace(/([A-Z])/g, "-$1").toLowerCase();
      }

      const ext = path.extname(file);
      const base = path.basename(file, ext);
      const dir = path.dirname(filePath);

      const editScope = msg.scope || "global";

      const srcDir = path.resolve(process.cwd(), "src");
      const allCssFiles = cache.getAllCssFiles(srcDir);
      const allJsxFiles = cache.getAllJsxFiles(srcDir);

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

      // If client tells us which file and selector to target, use that
      if (msg.targetFile && msg.targetSelector) {
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

      // If scope=local and selector is shared, create override in component CSS
      if (!cssFilePath || (editScope === "local" && cssFilePath !== componentCssFile)) {
        if (!componentCssFile) {
          componentCssFile = path.join(dir, `${base}.css`);
          cssSource = "";
          source = addCssImport(source, `${base}.css`, file);
        } else {
          cssSource = cache.readFile(componentCssFile) || "";
        }
        cssFilePath = componentCssFile;

        if (!targetSelector) {
          if (elClasses.length > 0) {
            targetSelector = elClasses.map((c) => `.${c}`).join("");
          } else if (elId) {
            targetSelector = `#${elId}`;
          }
        }
      }

      // Still no selector — create a BEM class
      if (!targetSelector) {
        if (!componentCssFile) {
          componentCssFile = path.join(dir, `${base}.css`);
          cssSource = "";
          source = addCssImport(source, `${base}.css`, file);
        }
        cssFilePath = componentCssFile;
        if (!cssSource && fs.existsSync(cssFilePath)) {
          cssSource = cache.readFile(cssFilePath) || "";
        }

        const block = base.replace(/([A-Z])/g, (m, c, i) => (i ? "-" : "") + c.toLowerCase());
        let element = elTag || "element";
        if (elId) element = elId.replace(/([A-Z])/g, "-$1").toLowerCase();

        const bemClass = `${block}__${element}`;
        targetSelector = `.${bemClass}`;

        const openPattern = new RegExp(
          match.opening + (match.type === "self-closing" ? "\\s*/>" : ">"),
          "s"
        );
        const openMatch = source.match(openPattern);
        if (openMatch) {
          const openTag = openMatch[0];
          const classAttrMatch = openTag.match(/class(?:Name)?=["']([^"']*)["']/);
          if (classAttrMatch) {
            const oldClasses = classAttrMatch[1];
            const newClasses = `${oldClasses} ${bemClass}`;
            source = source.replace(
              classAttrMatch[0],
              classAttrMatch[0].replace(oldClasses, newClasses)
            );
          } else {
            const closingBracket = openTag.endsWith("/>") ? " />" : ">";
            const withoutClose = openTag.slice(0, -closingBracket.length);
            source = source.replace(
              openTag,
              `${withoutClose} ${getClassAttr(file)}="${bemClass}"${closingBracket}`
            );
          }
        }
      }

      const cssRelPath = path.relative(process.cwd(), cssFilePath);

      // Save snapshots before writing
      saveSnapshot(filePath, file, "edit-style");
      saveSnapshot(cssFilePath, cssRelPath, "edit-style-css");

      // Write CSS properties to the target selector
      const cssPropsToWrite = Object.entries(styles)
        .map(([jsxKey, value]) => `  ${camelToKebab(jsxKey)}: ${value};`)
        .join("\n");

      const selectorEscaped = targetSelector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const selectorBlockPattern = new RegExp(`(${selectorEscaped}\\s*\\{)([^}]*)(\\})`, "s");
      const selectorMatch = cssSource.match(selectorBlockPattern);

      if (selectorMatch) {
        let blockBody = selectorMatch[2];
        for (const [jsxKey, value] of Object.entries(styles)) {
          const cssProp = camelToKebab(jsxKey);
          const propPattern = new RegExp(`(\\s*)${cssProp.replace(/[-]/g, "\\-")}\\s*:[^;]*;`, "s");
          if (propPattern.test(blockBody)) {
            blockBody = blockBody.replace(propPattern, `$1${cssProp}: ${value};`);
          } else {
            blockBody = blockBody.trimEnd() + `\n  ${cssProp}: ${value};\n`;
          }
        }
        cssSource = cssSource.replace(selectorBlockPattern, `$1${blockBody}$3`);
      } else {
        cssSource = cssSource.trimEnd() + `\n\n${targetSelector} {\n${cssPropsToWrite}\n}\n`;
      }

      // Write files and invalidate cache
      fs.writeFileSync(cssFilePath, cssSource, "utf-8");
      fs.writeFileSync(filePath, source, "utf-8");
      cache.invalidateFile(cssFilePath);
      cache.invalidateFile(filePath);

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
