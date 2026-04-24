#!/bin/bash
# Post-response hook for Tweakr extension
# Runs after every Claude response: format + lint + test

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0

# Only run if there are modified JS/CSS/HTML files
CHANGED=$(git diff --name-only --diff-filter=ACMR 2>/dev/null | grep -E '\.(js|css|html|json)$' | head -20)
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
LINT_OUT=$(npx eslint $CHANGED 2>&1) || true
if echo "$LINT_OUT" | grep -q " error "; then
  ERRORS="${ERRORS}ESLint: Errors found.\n${LINT_OUT}\n"
fi

# 3. Run tests
if [ -f "node_modules/.bin/vitest" ]; then
  TEST_OUT=$(npx vitest run --reporter=dot 2>&1)
  TEST_EXIT=$?
  if [ $TEST_EXIT -ne 0 ]; then
    ERRORS="${ERRORS}Tests: Failures detected.\n${TEST_OUT}\n"
  fi
fi

if [ -n "$ERRORS" ]; then
  echo "$ERRORS" >&2
  exit 2
fi

exit 0
