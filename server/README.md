# Tweakr Bridge Server

The engine behind Tweakr. This Node.js server receives edit commands from the Chrome extension via WebSocket and applies them directly to your source code files — text changes, CSS modifications, element deletions, and undo operations. You focus on the UI, the server handles the files.

## Architecture

```
Browser (Chrome Extension)
    |
    | WebSocket (ws://localhost:3333)
    |
Local Bridge Server (Node.js)
    |
    | fs.readFile / fs.writeFile
    |
Source Files (JSX, HTML, etc.)
```

## Setup

### 1. Start the Bridge Server

```bash
cd dom-sync-server
npm install
node server.js
```

The server starts on port 3333. Run it from your project root so file paths resolve correctly:

```bash
cd /path/to/your/project
node /path/to/dom-sync-server/server.js
```

### 2. Install the Chrome Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `dom-sync-extension/` folder

### 3. Use It

1. Click the DOM Sync extension icon in your toolbar
2. Enter the source file path (e.g., `src/components/LoginForm.jsx`) — this path is relative to where you started the server
3. Click **Activate on Current Tab**
4. Hover over any element on the page — you'll see a blue outline and a floating tooltip
5. Click **Delete** to remove the element from the source file
6. Click **Edit** to change the element's text content

### Testing with the Sample Component

A sample React component is included at `dom-sync-server/sample/src/components/LoginForm.jsx`. To test:

```bash
cd dom-sync-server/sample
# Start the bridge server from the sample directory
node ../server.js
```

Then set the file path in the extension popup to `src/components/LoginForm.jsx`.

## API

### `GET /changes`

Returns the change history log.

```bash
curl http://localhost:3333/changes
```

### WebSocket Messages

**Client -> Server:**

```json
{
  "action": "delete",
  "tag": "button",
  "id": "submit-btn",
  "classes": ["btn", "primary"],
  "text": "Submit",
  "file": "src/components/LoginForm.jsx"
}
```

```json
{
  "action": "edit",
  "tag": "button",
  "id": "submit-btn",
  "classes": ["btn", "primary"],
  "text": "Submit",
  "newText": "Log In",
  "file": "src/components/LoginForm.jsx"
}
```

**Server -> Client:**

```json
{
  "success": true,
  "message": "Deleted <button id=\"submit-btn\" class=\"btn primary\">"
}
```

## Notes

- The server resolves file paths relative to `process.cwd()`, so start it from your project root
- Path traversal outside the working directory is blocked for security
- All changes are logged to `changes.log` with timestamps
- The extension reconnects automatically if the server restarts
