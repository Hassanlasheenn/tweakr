#!/usr/bin/env node
// Usage: node scripts/changelog.js X.Y.Z
// Prepends a new changelog entry to CHANGELOG.md and vscode/CHANGELOG.md
// using commits since the last git tag.

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node scripts/changelog.js X.Y.Z");
  process.exit(1);
}

const ROOT = path.resolve(__dirname, "..");
const CHANGELOGS = [
  path.join(ROOT, "CHANGELOG.md"),
  path.join(ROOT, "vscode", "CHANGELOG.md"),
];

// Check if this version already exists in a file
function alreadyExists(file, ver) {
  const content = fs.readFileSync(file, "utf-8");
  return content.includes(`## [${ver}]`);
}

// Get commits since the last tag
function getCommitsSinceLastTag() {
  let range = "";
  try {
    const lastTag = execSync("git describe --tags --abbrev=0", {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    range = `${lastTag}..HEAD`;
  } catch {
    // No tags yet — use all commits
    range = "HEAD";
  }

  const log = execSync(`git log ${range} --format="%s"`, {
    cwd: ROOT,
    encoding: "utf-8",
  });

  return log
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^release: v/.test(l));
}

// Categorize commits by conventional commit prefix
function categorize(commits) {
  const added = [];
  const fixed = [];
  const changed = [];

  for (const msg of commits) {
    const match = msg.match(/^(\w+)(?:\([^)]+\))?:\s*(.+)/);
    const text = match
      ? match[2].charAt(0).toUpperCase() + match[2].slice(1)
      : msg.charAt(0).toUpperCase() + msg.slice(1);
    const prefix = match ? match[1] : "";

    if (["feat", "feature"].includes(prefix)) {
      added.push(text);
    } else if (["fix", "perf"].includes(prefix)) {
      fixed.push(text);
    } else {
      changed.push(text);
    }
  }

  return { added, fixed, changed };
}

// Build the changelog entry block
function buildEntry(ver, commits) {
  const date = new Date().toISOString().split("T")[0];
  const { added, fixed, changed } = categorize(commits);

  let entry = `## [${ver}] - ${date}\n`;

  if (added.length) {
    entry += `\n### Added\n${added.map((l) => `- ${l}`).join("\n")}\n`;
  }
  if (fixed.length) {
    entry += `\n### Fixed\n${fixed.map((l) => `- ${l}`).join("\n")}\n`;
  }
  if (changed.length) {
    entry += `\n### Changed\n${changed.map((l) => `- ${l}`).join("\n")}\n`;
  }

  // Fallback if no commits found
  if (!added.length && !fixed.length && !changed.length) {
    entry += `\n### Changed\n- Internal release bump\n`;
  }

  return entry;
}

// Prepend entry after the "# Changelog" header
function prependEntry(file, entry) {
  const content = fs.readFileSync(file, "utf-8");
  const headerEnd = content.indexOf("\n", content.indexOf("# Changelog")) + 1;
  const updated =
    content.slice(0, headerEnd) + "\n" + entry + "\n" + content.slice(headerEnd);
  fs.writeFileSync(file, updated, "utf-8");
}

// --- Main ---
const commits = getCommitsSinceLastTag();
const entry = buildEntry(version, commits);

let skipped = 0;
for (const file of CHANGELOGS) {
  if (alreadyExists(file, version)) {
    console.log(`⚠  Skipped ${path.relative(ROOT, file)} — v${version} already present`);
    skipped++;
    continue;
  }
  prependEntry(file, entry);
  console.log(`✓  Updated ${path.relative(ROOT, file)}`);
}

if (skipped === CHANGELOGS.length) {
  console.log("No files updated.");
  process.exit(0);
}

console.log(`\nEntry added for v${version}:\n`);
console.log(entry);
