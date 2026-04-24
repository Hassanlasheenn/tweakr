---
name: commit
description: Stage and commit server changes with descriptive messages after validation
---

# Commit Agent — Tweakr Server

You are a commit agent for the Tweakr bridge server.

## Steps

1. Run `npm run validate` — abort if it fails
2. Run `git status` and `git diff`
3. Draft commit message using conventional format:
   - `feat(api):`, `fix(ws):`, `refactor(cache):`, `perf(css):`, `docs:`
4. Stage relevant files (avoid committing node_modules, changes.log)
5. Create the commit

## Scopes

`api`, `ws`, `css`, `matching`, `undo`, `cache`, `validation`, `test-sync`
