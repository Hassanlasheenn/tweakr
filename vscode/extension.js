const vscode = require("vscode");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

let serverProcess = null;
let statusBarItem = null;
let outputChannel = null;

function getServerPath() {
  // Try to find server.js in common locations
  const candidates = [
    // Installed as npm dependency in the project
    path.join("node_modules", "tweakr", "server.js"),
    // Globally installed
    path.join(__dirname, "..", "server", "server.js"),
  ];

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    for (const candidate of candidates) {
      const full = path.join(workspaceFolder.uri.fsPath, candidate);
      try {
        require("fs").accessSync(full);
        return full;
      } catch {}
    }
  }

  // Fallback: use npx to run tweakr
  return null;
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
    vscode.window.showErrorMessage("No workspace folder open.");
    return;
  }

  const cwd = workspaceFolder.uri.fsPath;
  const port = getPort();
  const serverPath = getServerPath();

  outputChannel.clear();
  outputChannel.appendLine(`Starting Tweakr server on port ${port}...`);
  outputChannel.appendLine(`Working directory: ${cwd}`);

  const env = { ...process.env, TWEAKR_PORT: String(port) };

  if (serverPath) {
    // Run server.js directly
    outputChannel.appendLine(`Server path: ${serverPath}`);
    serverProcess = spawn(process.execPath, [serverPath], { cwd, env });
  } else {
    // Fall back to npx tweakr
    outputChannel.appendLine("Using: npx tweakr");
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
    if (attempts > 20) {
      clearInterval(checkReady);
      return;
    }
    const req = http.get(`http://localhost:${port}/agents/explore`, (res) => {
      if (res.statusCode === 200) {
        clearInterval(checkReady);
        updateStatusBar("running");
        outputChannel.appendLine("Server is ready.");
      }
      res.resume();
    });
    req.on("error", () => {}); // not ready yet
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
      statusBarItem.tooltip = `Tweakr server running on port ${getPort()}`;
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
    100,
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tweakr.start", startServer),
    vscode.commands.registerCommand("tweakr.stop", stopServer),
    vscode.commands.registerCommand("tweakr.restart", restartServer),
    statusBarItem,
    outputChannel,
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
