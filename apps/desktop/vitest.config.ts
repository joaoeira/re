import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/renderer/src"),
      "@main": path.resolve(__dirname, "src/main"),
      "@preload": path.resolve(__dirname, "src/preload"),
      "@shared": path.resolve(__dirname, "src/shared"),
      electron: path.resolve(__dirname, "test/mocks/electron.ts"),
      react: path.resolve(__dirname, "../../node_modules/react"),
      "react-dom": path.resolve(__dirname, "../../node_modules/react-dom"),
      "react/jsx-runtime": path.resolve(__dirname, "../../node_modules/react/jsx-runtime.js"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
