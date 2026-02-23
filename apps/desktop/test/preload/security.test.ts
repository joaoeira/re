import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("preload security", () => {
  it("uses a constrained bridge global and avoids exposing raw ipcRenderer", () => {
    const preloadSource = readFileSync(path.join(__dirname, "../../src/preload/index.ts"), "utf8");

    expect(preloadSource).toContain("appIpc.preload");
    expect(preloadSource).toContain(".expose()");
    expect(preloadSource).toMatch(/await\s+appIpc\.preload\(/);
    expect(preloadSource).not.toContain("ipcRenderer");
    expect(preloadSource).not.toContain('contextBridge.exposeInMainWorld("ipcRenderer"');
  });
});
