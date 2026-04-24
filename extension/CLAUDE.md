# Tweakr Chrome Extension

Chrome extension (Manifest V3) for hover-to-edit DOM elements with live CSS editing. Works with any React/frontend project via the Tweakr bridge server.

## Architecture

```
popup.html/popup.js  — Extension popup UI (activate, status)
content.js           — Injected into page: hover detection, tooltip, style panel, WebSocket client
background.js        — Service worker: handles extension icon click, injects content script
styles.css           — All UI styles (tooltip, panels, toasts, scope badges)
manifest.json        — Extension config (Manifest V3, activeTab + scripting + storage)
```

## How It Works

1. User clicks extension icon → `popup.js` checks server status via `GET /agents/explore`
2. "Start Editing" injects `content.js` + `styles.css` into the active tab
3. `content.js` connects to `ws://localhost:3333` (bridge server)
4. Hover detection highlights elements, shows tooltip with action buttons
5. Actions (delete/edit/style/undo) are sent as JSON over WebSocket
6. Server modifies source files, responds with success/error
7. Toast notification confirms the result

## Key Components in content.js

| Section | Purpose |
|---------|---------|
| `STYLE_GROUPS` | Default CSS property groups for the style panel |
| `ALL_CSS_PROPS` | 70+ CSS properties for autocomplete dropdown |
| `loadComponents()` | Fetches component map from `/agents/explore` |
| `detectFileForElement(el)` | Scores elements against componentMap to find source file |
| `showStylePanel(el)` | Renders grouped CSS editor with scope badges and toggles |
| `showInlineEdit(el)` | Text editing panel |
| `describeElement(el)` | Builds element fingerprint (tag, id, classes, text, file) |
| `selectorMeta` | Tracks which CSS file and scope each selector comes from |

## WebSocket Message Protocol

### Client → Server
```json
{ "action": "delete", "tag": "h1", "id": "title", "classes": ["heading"], "text": "Hello", "file": "src/components/App.jsx" }
{ "action": "edit", "tag": "button", "id": "submit", "text": "Submit", "newText": "Send", "file": "..." }
{ "action": "edit-style", "tag": "button", "classes": ["btn"], "styles": {"color": "#fff"}, "scope": "global", "targetFile": "src/App.css", "targetSelector": ".btn", "file": "..." }
{ "action": "undo" }
```

### Server → Client
```json
{ "success": true, "message": "Deleted <h1>" }
{ "success": false, "message": "Could not find element" }
```

## Commands

```bash
npm run lint          # ESLint check
npm run lint:fix      # ESLint auto-fix
npm run format        # Prettier format all files
npm run format:check  # Prettier check (no write)
npm run test          # Run test suite (vitest)
npm run test:watch    # Run tests in watch mode
npm run validate      # test + format:check + lint
```

## Recurrent Checks

After any code change, run:

### 1. Test Suite
```bash
npm run test
```
- All tests must pass
- Tests live in `test/` directory
- Uses Vitest + jsdom

### 2. Format Check
```bash
npm run format:check
```

### 3. Lint Check
```bash
npm run lint
```
- Must pass with zero errors
- Warnings should be reviewed

### 4. Manual Testing
- Load unpacked extension in `chrome://extensions`
- Open a React app with the server running
- Test: hover highlight, tooltip buttons, style panel, edit panel, undo, toast messages

### Quick Validation
```bash
npm run validate
```

## Shared CSS Scope System

The style panel detects whether CSS rules are shared across components:

- **Scope badges**: "Shared (N)" or "Global" appear next to shared selectors
- **File labels**: Show which CSS file each rule comes from
- **Scope toggle**: "All components" vs "This component" — controls whether edits go to the shared CSS file or create a local override
- **Apply button**: Sends `scope`, `targetFile`, `targetSelector` to server for precise editing

## Protected Elements

- Form controls (input, select, textarea) — style only, no delete
- Dynamic content (`{expressions}`) — style only, no text edit
- Elements with event handlers — blocked from deletion
- Structural tags (html, head, body, script) — ignored entirely

## CSS Editing Rules

- Never write `style={{ }}` inline — all CSS goes to external files
- Class-first: find matching selector in CSS file, update there
- BEM naming for new classes: `.component-name__element-name`
- Compound selectors preserved (`.btn.primary`)

## Testing Conventions

- Test files: `test/*.test.js`
- Pure utility functions go in `content-utils.js` (TweakrUtils namespace)
- Tests mock `chrome.*` APIs via `test/setup.js`
- Use `globalThis.__TWEAKR_TEST__` guard to prevent auto-execution in tests
- New utility functions must have corresponding tests
- Never use bare `console.log` — use the `log()` debug wrapper

## Post-Prompt Hook

The `Stop` hook (`.claude/hooks/post-response.sh`) runs automatically after every Claude response:
1. Auto-formats changed files with Prettier
2. Runs ESLint on changed files
3. Runs the full test suite
4. Blocks if any step fails
