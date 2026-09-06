import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sharedAliases = {
  "@": path.resolve(__dirname, "src/renderer/src"),
  "@main": path.resolve(__dirname, "src/main"),
  "@preload": path.resolve(__dirname, "src/preload"),
  "@shared": path.resolve(__dirname, "src/shared"),
  react: path.dirname(require.resolve("react/package.json")),
  "react-dom": path.dirname(require.resolve("react-dom/package.json")),
  "react/jsx-runtime": require.resolve("react/jsx-runtime"),
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
        optimizeDeps: {
          entries: ["test/**/*.browser.test.tsx", "src/renderer/src/**/*.{ts,tsx}"],
          include: [
            "@tanstack/react-query",
            "@base-ui/react/dialog",
            "@base-ui/react/context-menu",
            "@base-ui/react/menu",
            "@base-ui/react/number-field",
            "@base-ui/react/popover",
            "@benrbray/prosemirror-math",
            "@tiptap/pm/inputrules",
            "@tiptap/pm/state",
          ],
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
