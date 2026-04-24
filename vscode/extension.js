const vscode = require("vscode");
const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

let serverProcess = null;
let statusBarItem = null;
let outputChannel = null;

/**
 * Dynamic server discovery — tries each source in order:
 * 1. Bundled with this extension (always available)
 * 2. Project's node_modules (if user installed tweakr as dev dep)
 * 3. Globally installed via npm
 * Returns { mode, serverPath } or { mode: "npx" } as last resort
 */
function discoverServer() {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // 1. Bundled — ships inside this extension, always works
  const bundled = path.join(__dirname, "bundled", "server.js");
  if (fs.existsSync(bundled)) {
    return { mode: "bundled", serverPath: bundled };
  }

  // 2. Project local — user ran `npm install tweakr` in their project
  if (workspacePath) {
    const projectLocal = path.join(workspacePath, "node_modules", "tweakr", "server.js");
    if (fs.existsSync(projectLocal)) {
      return { mode: "project", serverPath: projectLocal };
    }
  }

  // 3. Global npm — user ran `npm install -g tweakr`
  try {
    const globalPrefix = execSync("npm root -g", { encoding: "utf-8" }).trim();
    const globalPath = path.join(globalPrefix, "tweakr", "server.js");
    if (fs.existsSync(globalPath)) {
      return { mode: "global", serverPath: globalPath };
    }
  } catch {}

  // 4. Fallback — npx downloads and runs on first use
  return { mode: "npx", serverPath: null };
}

function getPort() {
  return vscode.workspace.getConfiguration("tweakr").get("port", 3333);
}

function startServer() {
  if (serverProcess) {
    vscode.window.showInformationMessage("Tweakr server is already running.");
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("Tweakr: No workspace folder open.");
    return;
  }

  const cwd = workspaceFolder.uri.fsPath;
  const port = getPort();
  const { mode, serverPath } = discoverServer();

  outputChannel.clear();
  outputChannel.appendLine(`Tweakr starting on port ${port}...`);
  outputChannel.appendLine(`Working directory: ${cwd}`);
  outputChannel.appendLine(`Server source: ${mode}${serverPath ? ` (${serverPath})` : ""}`);

  const env = { ...process.env, TWEAKR_PORT: String(port) };

  if (serverPath) {
    // Set NODE_PATH so bundled server.js can find the ws module
    const nodeModulesPath = path.join(__dirname, "node_modules");
    env.NODE_PATH = nodeModulesPath;

    serverProcess = spawn(process.execPath, [serverPath], { cwd, env });
  } else {
    // npx fallback
    outputChannel.appendLine("Using: npx tweakr (downloading if needed...)");
    serverProcess = spawn("npx", ["tweakr", "--port", String(port)], {
      cwd,
      env,
      shell: true,
    });
  }

  serverProcess.stdout.on("data", (data) => {
    outputChannel.append(data.toString());
  });

  serverProcess.stderr.on("data", (data) => {
    outputChannel.append(data.toString());
  });

  serverProcess.on("error", (err) => {
    outputChannel.appendLine(`Error: ${err.message}`);
    vscode.window.showErrorMessage(`Tweakr: Failed to start — ${err.message}`);
    serverProcess = null;
    updateStatusBar("stopped");
  });

  serverProcess.on("exit", (code) => {
    outputChannel.appendLine(`Server exited with code ${code}`);
    serverProcess = null;
    updateStatusBar("stopped");
  });

  updateStatusBar("starting");

  // Poll for server readiness
  let attempts = 0;
  const checkReady = setInterval(() => {
    attempts++;
    if (attempts > 30) {
      clearInterval(checkReady);
      updateStatusBar("stopped");
      outputChannel.appendLine("Server failed to start within 15 seconds.");
      return;
    }
    const req = http.get(`http://localhost:${port}/agents/explore`, (res) => {
      if (res.statusCode === 200) {
        clearInterval(checkReady);
        updateStatusBar("running");
        outputChannel.appendLine("Server is ready.");
        vscode.window.showInformationMessage(
          `Tweakr running on port ${port}. Open Chrome and activate the extension.`
        );
      }
      res.resume();
    });
    req.on("error", () => {});
    req.setTimeout(500, () => req.destroy());
  }, 500);
}

function stopServer() {
  if (!serverProcess) {
    vscode.window.showInformationMessage("Tweakr server is not running.");
    return;
  }

  serverProcess.kill();
  serverProcess = null;
  updateStatusBar("stopped");
  outputChannel.appendLine("Server stopped.");
}

function restartServer() {
  if (serverProcess) {
    serverProcess.on("exit", () => {
      serverProcess = null;
      startServer();
    });
    serverProcess.kill();
  } else {
    startServer();
  }
}

function updateStatusBar(state) {
  if (!statusBarItem) return;

  switch (state) {
    case "running":
      statusBarItem.text = "$(check) Tweakr";
      statusBarItem.tooltip = `Tweakr server running on port ${getPort()} — click to stop`;
      statusBarItem.color = "#34d399";
      statusBarItem.command = "tweakr.stop";
      break;
    case "starting":
      statusBarItem.text = "$(sync~spin) Tweakr";
      statusBarItem.tooltip = "Tweakr server starting...";
      statusBarItem.color = "#fbbf24";
      statusBarItem.command = "tweakr.stop";
      break;
    case "stopped":
      statusBarItem.text = "$(circle-slash) Tweakr";
      statusBarItem.tooltip = "Tweakr server stopped — click to start";
      statusBarItem.color = "#6b7280";
      statusBarItem.command = "tweakr.start";
      break;
  }

  statusBarItem.show();
}

function activate(context) {
  outputChannel = vscode.window.createOutputChannel("Tweakr");
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tweakr.start", startServer),
    vscode.commands.registerCommand("tweakr.stop", stopServer),
    vscode.commands.registerCommand("tweakr.restart", restartServer),
    statusBarItem,
    outputChannel
  );

  updateStatusBar("stopped");

  // Auto-start if enabled
  const autoStart = vscode.workspace
    .getConfiguration("tweakr")
    .get("autoStart", true);
  if (autoStart) {
    startServer();
  }
}

function deactivate() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

module.exports = { activate, deactivate };
