import { vi } from "vitest";

// Mock chrome.* APIs
globalThis.chrome = {
  runtime: {
    onMessage: { addListener: vi.fn() },
    sendMessage: vi.fn(),
    lastError: null,
  },
  tabs: {
    query: vi.fn().mockResolvedValue([{ id: 1, url: "http://localhost:5173" }]),
    sendMessage: vi.fn(),
  },
  scripting: {
    executeScript: vi.fn().mockResolvedValue([]),
    insertCSS: vi.fn().mockResolvedValue(),
  },
  action: {
    onClicked: { addListener: vi.fn() },
  },
  storage: {
    sync: {
      get: vi.fn().mockImplementation((defaults, cb) => cb(defaults)),
      set: vi.fn().mockImplementation((_obj, cb) => cb && cb()),
    },
  },
};

// Mock WebSocket
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
    this._lastSent = null;
  }
  send(data) {
    this._lastSent = data;
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
}
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;
globalThis.WebSocket = MockWebSocket;

// Load TweakrUtils from content-utils.js
import fs from "fs";
import path from "path";
const utilsCode = fs.readFileSync(path.resolve("content-utils.js"), "utf-8");
// Execute in global scope to populate globalThis.TweakrUtils
new Function(utilsCode)();
