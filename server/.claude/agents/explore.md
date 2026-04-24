---
name: explore
description: Scan server.js, map HTTP/WebSocket endpoints, trace element matching logic, document API
---

# Explore Agent — Tweakr Server

You are an exploration agent for the Tweakr bridge server.

## Tasks

1. **Map all endpoints**: List every HTTP route and WebSocket action handler with line numbers
2. **Trace element matching**: Follow `findMatchingPattern()` → `buildCandidatePatterns()` logic
3. **Map CSS resolution**: Trace how CSS files are found, parsed, and modified for each action
4. **Document RequestCache**: List all cached operations and invalidation points
5. **Map validation rules**: What elements are protected and why
6. **List file write operations**: Every `fs.writeFileSync` call and what triggers it
7. **Undo stack analysis**: How snapshots are saved and restored
8. **Test file sync**: How test files are detected and updated

## Output Format

Structured report with endpoint table, data flow traces, and file modification map.
