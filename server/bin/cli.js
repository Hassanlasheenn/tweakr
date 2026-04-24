#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Parse CLI args
const args = process.argv.slice(2);
let port = 3333;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" || args[i] === "-p") {
    port = parseInt(args[i + 1], 10) || 3333;
    i++;
  }
  if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
  Tweakr — Visual code editor bridge server

  Usage:
    tweakr [options]
    npx tweakr [options]

  Options:
    -p, --port <number>   Server port (default: 3333)
    -h, --help            Show this help

  Run this command from your project root directory.
  Then open Chrome and activate the Tweakr extension.

  Example:
    cd my-react-app
    npx tweakr
`);
    process.exit(0);
  }
}

// Check if src/ exists in CWD
const srcDir = path.resolve(process.cwd(), "src");
if (!fs.existsSync(srcDir)) {
  // Also check for index.html at root
  const indexHtml = path.resolve(process.cwd(), "index.html");
  if (!fs.existsSync(indexHtml)) {
    console.log("\x1b[33m⚠ No src/ folder or index.html found in current directory.\x1b[0m");
    console.log("  Tweakr scans your source files to enable editing.");
    console.log("  Make sure you run this from your project root.\n");
  }
}

// Start the server
const serverPath = path.join(__dirname, "..", "server.js");
const env = { ...process.env, TWEAKR_PORT: String(port) };

const child = spawn(process.execPath, [serverPath], {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
});

child.on("error", (err) => {
  console.error("Failed to start Tweakr server:", err.message);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code || 0);
});

// Forward signals
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
