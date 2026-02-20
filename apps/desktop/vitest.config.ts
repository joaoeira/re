import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sharedAliases = {
  "@": path.resolve(__dirname, "src/renderer/src"),
  "@main": path.resolve(__dirname, "src/main"),
  "@preload": path.resolve(__dirname, "src/preload"),
  "@shared": path.resolve(__dirname, "src/shared"),
  react: path.resolve(__dirname, "../../node_modules/react"),
  "react-dom": path.resolve(__dirname, "../../node_modules/react-dom"),
  "react/jsx-runtime": path.resolve(__dirname, "../../node_modules/react/jsx-runtime.js"),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            ...sharedAliases,
            electron: path.resolve(__dirname, "test/mocks/electron.ts"),
          },
        },
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
          exclude: ["test/**/*.browser.test.tsx"],
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: sharedAliases,
        },
        test: {
          name: "browser",
          include: ["test/**/*.browser.test.tsx"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
