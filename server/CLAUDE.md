# Tweakr Bridge Server

Node.js WebSocket + HTTP server that bridges the Tweakr Chrome extension to source code files. Receives DOM edit actions and modifies JSX/CSS files on disk.

## Architecture

```
server.js (single file, ~1250 lines)
├── HTTP server (port 3333)
│   ├── GET /              — Dynamic HTML preview from JSX source
│   ├── GET /agents/explore — Scan components, list DOM elements
│   ├── GET /agents/styles  — Parse CSS rules per element (with scope metadata)
│   ├── GET /agents/plan    — File source + git diff + recent changes
│   ├── GET /agents/review  — Git status, diff, staged changes
│   └── POST /agents/commit — Stage files and create git commit
├── WebSocket server (same port)
│   ├── action: "delete"     — Remove element from JSX
│   ├── action: "edit"       — Change element text in JSX
│   ├── action: "edit-style" — Modify CSS files (scope-aware)
│   └── action: "undo"       — Restore file from snapshot stack
└── Helpers
    ├── RequestCache          — Per-request file read deduplication
    ├── findMatchingPattern() — Regex element matching (id > classes > text > tag)
    ├── validateAction()      — Block protected elements
    ├── syncTestFile()        — Auto-update test files on delete/edit
    ├── saveSnapshot()        — Undo stack (max 50)
    └── Shared CSS helpers    — Cross-file selector search with scope detection
```

## Commands

```bash
npm start             # Start server on port 3333
npm run dev           # Start with --watch (auto-restart on changes)
npm run lint          # ESLint check
npm run lint:fix      # ESLint auto-fix
npm run format        # Prettier format all files
npm run format:check  # Prettier check
npm run validate      # format:check + lint + syntax check
```

## Recurrent Checks

After any code change:

### 1. Syntax Check

```bash
node -c server.js
```

### 2. Format + Lint

```bash
npm run validate
```

### 3. Manual Testing

Start the server and test with the extension:

```bash
npm start
```

- Test element delete, edit, style actions via WebSocket
- Test `/agents/explore`, `/agents/styles` endpoints
- Test undo functionality
- Test with shared CSS files (scope: global vs local)

## Key Systems

### Element Matching (`findMatchingPattern`)

Tries patterns in priority order:

1. `id` attribute match
2. Compound class selector (`.btn.primary`)
3. Single class selector
4. Text content match
5. Generic tag match

### Validation (`validateAction`)

Blocks dangerous operations:

- Form elements (input, select, textarea) — no deletion
- Submit buttons — no deletion
- Event handlers (`onClick`, `onChange`) — no deletion
- Dynamic content (`{variable}`) — no text editing

### CSS-First Style Editing (`edit-style`)

- Resolves CSS file: `Component.css` → `.module.css` → `.scss`
- Searches ALL CSS files via `RequestCache` (cached reads)
- Scope-aware: `scope: "global"` edits shared file, `scope: "local"` creates component override
- BEM class creation for unclassed elements
- Never writes inline `style={{ }}`

### RequestCache (Performance)

Per-request cache that deduplicates file reads:

- `getAllCssFiles()` — cached dir walk
- `getAllJsxFiles()` — cached dir walk
- `readFile()` — cached file read (returns null if missing)
- `getComponentsUsingCss()` — cached component-CSS mapping
- `invalidateFile()` — clears after server writes

### Test File Sync (`syncTestFile`)

When elements are deleted/edited, automatically updates corresponding test files:

- Removes test blocks referencing deleted elements
- Updates `getByText()` patterns with new text

### Undo Stack

- Saves file snapshots before each write (max 50)
- Restores last snapshot on `action: "undo"`

## WebSocket Protocol

### Incoming Messages

| Field            | Type     | Required   | Description                            |
| ---------------- | -------- | ---------- | -------------------------------------- |
| `action`         | string   | yes        | `delete`, `edit`, `edit-style`, `undo` |
| `tag`            | string   | yes\*      | HTML tag name                          |
| `id`             | string   | no         | Element ID                             |
| `classes`        | string[] | no         | Element class list                     |
| `text`           | string   | no         | Element text content                   |
| `file`           | string   | yes\*      | Source file path                       |
| `newText`        | string   | edit only  | Replacement text                       |
| `styles`         | object   | edit-style | `{ camelCaseKey: "value" }`            |
| `scope`          | string   | no         | `"global"` (default) or `"local"`      |
| `targetFile`     | string   | no         | Exact CSS file to edit                 |
| `targetSelector` | string   | no         | Exact CSS selector to target           |

### Outgoing Messages

```json
{ "success": true, "message": "Styled .btn" }
{ "success": false, "message": "Could not find <button> in LoginForm.jsx" }
```

## Agent API Endpoints

| Endpoint                                 | Method | Purpose                                             |
| ---------------------------------------- | ------ | --------------------------------------------------- |
| `/agents/explore`                        | GET    | List all JSX components and their DOM elements      |
| `/agents/styles?file=&tag=&id=&classes=` | GET    | Get CSS rules with scope metadata per element       |
| `/agents/plan?file=`                     | GET    | File source, git diff, recent changes               |
| `/agents/review`                         | GET    | Git status, diff, staged changes, change log        |
| `/agents/commit`                         | POST   | `{ files: [...], message: "..." }` — stage + commit |
