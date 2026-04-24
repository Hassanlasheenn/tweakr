# Tweakr

Visual code editor for frontend developers. Hover over any element on your page to edit text, modify CSS styles, delete elements, or undo changes — all synced directly to your source code.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)

## How It Works

1. Start the bridge server in your project directory
2. Open your app in Chrome
3. Click the Tweakr extension icon and hit "Start Editing"
4. Hover over any element — a toolbar appears with edit, style, delete, and undo buttons
5. Changes are written directly to your source code files

## Features

- **Hover-to-edit** — click any element to change its text or remove it
- **Live CSS editor** — inspect and modify source CSS properties with live preview
- **Scope-aware styling** — edit shared CSS globally or override for a single component
- **BEM class generation** — automatically creates properly-named classes for unclassed elements
- **Undo support** — revert any change with one click
- **Test file sync** — automatically updates test files when elements change
- **Protected elements** — form controls and dynamic content are safeguarded

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Start the bridge server

```bash
cd server
npm start
```

The server runs on `http://localhost:3333` by default.

### 3. Load the extension

1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `extension/` folder

### 4. Use it

1. Open your React/Vue/frontend app in Chrome
2. Click the Tweakr icon in the toolbar
3. Click "Start Editing"
4. Hover over elements and use the floating toolbar

## Project Structure

```
tweakr/
├── extension/              # Chrome extension (Manifest V3)
│   ├── manifest.json       # Extension config
│   ├── content-utils.js    # Pure utility functions (testable)
│   ├── content.js          # Injected into pages: hover, tooltip, style panel
│   ├── popup.html/js       # Extension popup UI
│   ├── background.js       # Service worker
│   ├── options.html/js     # Server settings page
│   ├── styles.css          # All extension UI styles
│   └── test/               # Vitest test suite
│
├── server/                 # Bridge server (Node.js)
│   ├── server.js           # HTTP + WebSocket server
│   ├── CLAUDE.md           # Server documentation
│   └── package.json
│
└── package.json            # Root workspace config
```

## Configuration

Click the Tweakr extension icon → right-click → "Options" to configure:

- **Server Host** — default: `localhost`
- **Server Port** — default: `3333`

## Development

```bash
# Run all tests
npm test

# Lint all code
npm run lint

# Format all code
npm run format

# Full validation (test + lint + format)
npm run validate

# Start server in watch mode
npm run dev
```

## Works With

- React (JSX/TSX)
- Vue (SFC)
- Any frontend framework with JSX/TSX components

## Privacy

Tweakr does not collect, transmit, or store any personal data. All communication is between the extension and a local server on your machine. See [Privacy Policy](extension/PRIVACY.md).

## License

MIT
