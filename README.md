# Tweakr

**Edit your UI, visually.**

Tweakr puts you in control of your UI — directly from the browser. Instead of hunting through component files to change a color, fix a typo, or remove an element, just hover over it and click. Your source code updates instantly. No context switching. No file searching. Just point, click, and ship.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)

## How It Works

1. Open your project in VS Code — the server starts automatically
2. Open your app in Chrome and click the Tweakr icon
3. Hover over any element — a toolbar appears
4. Edit text, modify CSS, delete elements, or undo — all in one click
5. Your source code updates instantly. Check git to see the changes.

## Features

- **Stop searching, start editing** — hover over any element to change text, styles, or remove it
- **Live CSS editing** — modify colors, spacing, typography with instant preview
- **Works everywhere** — React, Vue, Svelte, Angular, vanilla HTML
- **Safe by default** — form inputs, dynamic data, and event handlers are protected
- **One-click undo** — revert any change instantly
- **Zero config** — VS Code extension auto-starts the server, Chrome extension handles the rest
- **Scope-aware styling** — edit shared CSS globally or override for a single component

## Quick Start

### Option A: VS Code Extension (Recommended)

1. Install the **Tweakr** VS Code extension from the marketplace
2. Open your project in VS Code — the server starts automatically
3. Open your app in Chrome and activate the Tweakr Chrome extension
4. Hover over elements and use the floating toolbar

The status bar shows "Tweakr" with the server state. Click it to start/stop.

### Option B: npx (no install)

```bash
cd your-project
npx tweakr
```

Then open Chrome and activate the Tweakr extension.

### Option C: Global install

```bash
npm install -g tweakr
cd your-project
tweakr
```

### Load the Chrome extension

1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `extension/` folder

Or install from the Chrome Web Store (coming soon).

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
├── server/                 # Bridge server (npm package)
│   ├── server.js           # HTTP + WebSocket server
│   ├── bin/cli.js          # CLI entry point (npx tweakr)
│   └── package.json
│
├── vscode/                 # VS Code extension
│   ├── extension.js        # Auto-starts server on project open
│   └── package.json        # VS Code extension manifest
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

- **Vanilla HTML/CSS/JS** — plain `.html` files with linked stylesheets
- **React** — JSX/TSX components
- **Vue** — Single File Components (`.vue`)
- **Svelte** — `.svelte` components
- **Angular** — component templates
- **Any framework** that renders HTML to the DOM

## Privacy

Tweakr does not collect, transmit, or store any personal data. All communication is between the extension and a local server on your machine. See [Privacy Policy](extension/PRIVACY.md).

## License

MIT
