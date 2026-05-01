import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./test/setup.js",
    include: ["test/**/*.test.js"],
    pool: "vmThreads",
    testTimeout: 90000,
  },
});
