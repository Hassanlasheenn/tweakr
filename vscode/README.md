# Tweakr for VS Code

Zero-config setup for Tweakr. Open your project — the server starts automatically. No terminal commands, no setup. Just open Chrome, hover over any element, and edit your UI visually. Source code updates instantly.

## How It Works

1. Open any frontend project in VS Code
2. Tweakr auto-detects `src/` folder and starts the bridge server
3. Open your app in Chrome and activate the Tweakr Chrome extension
4. Hover over elements to edit text, CSS styles, or delete them

## Status Bar

The status bar shows the server state — click it to toggle:

- **✓ Tweakr** — Server running (click to stop)
- **⊘ Tweakr** — Server stopped (click to start)

## Commands

- `Tweakr: Start Server`
- `Tweakr: Stop Server`
- `Tweakr: Restart Server`

## Settings

| Setting            | Default | Description                   |
| ------------------ | ------- | ----------------------------- |
| `tweakr.port`      | `3333`  | Bridge server port            |
| `tweakr.autoStart` | `true`  | Auto-start when project opens |

## Requirements

- [Tweakr Chrome Extension](https://chrome.google.com/webstore) for visual editing
- Node.js 18+
