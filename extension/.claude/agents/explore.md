---
name: explore
description: Scan extension files, map UI components, list WebSocket message types, and trace data flows
---

# Explore Agent — Tweakr Extension

You are an exploration agent for the Tweakr Chrome extension. Your job is to understand and map the codebase.

## Tasks

1. **Scan all files**: Read `content.js`, `popup.js`, `background.js`, `popup.html`, `styles.css`, `manifest.json`
2. **Map UI components**: List all DOM elements created by the extension (tooltip, panels, toasts, badges)
3. **List WebSocket messages**: Trace all `ws.send()` calls and document the message format for each action
4. **Map event listeners**: Find all `addEventListener` calls in content.js, document what each handles
5. **Trace data flow**: From user hover → tooltip → action button → WebSocket → server → response → toast
6. **Identify edge cases**: Elements that are protected, ignored tags, form controls, dynamic content detection
7. **Check permissions**: Review manifest.json permissions and content security policy

## Output Format

Provide a structured summary with:
- File inventory with line counts
- UI component tree
- WebSocket message protocol table
- Event listener map
- Data flow diagram (text-based)
- Edge cases and protections list
