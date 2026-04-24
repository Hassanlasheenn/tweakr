#!/bin/bash
# Post-response hook for Tweakr server
# Runs after every Claude response: format + lint + syntax check

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0

# Only run if server.js or config files changed
CHANGED=$(git diff --name-only --diff-filter=ACMR 2>/dev/null | grep -E '\.(js|json|md)$' | head -20)
if [ -z "$CHANGED" ]; then
  exit 0
fi

ERRORS=""

# 1. Auto-format with prettier
if ! npx prettier --check $CHANGED 2>/dev/null; then
  npx prettier --write $CHANGED 2>/dev/null
  ERRORS="${ERRORS}Prettier: Auto-formatted files.\n"
fi

# 2. Lint check
JS_FILES=$(echo "$CHANGED" | grep '\.js$' || true)
if [ -n "$JS_FILES" ]; then
  LINT_OUT=$(npx eslint $JS_FILES 2>&1) || true
  if echo "$LINT_OUT" | grep -q " error "; then
    ERRORS="${ERRORS}ESLint: Errors found.\n${LINT_OUT}\n"
  fi
fi

# 3. Syntax check on server.js
if echo "$CHANGED" | grep -q "server.js"; then
  if ! node -c server.js 2>/dev/null; then
    ERRORS="${ERRORS}Syntax: server.js has syntax errors.\n"
  fi
fi

if [ -n "$ERRORS" ]; then
  echo "$ERRORS" >&2
  exit 2
fi

exit 0
