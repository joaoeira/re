import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const exposeIpcBridge = vi.hoisted(() => vi.fn());
const exposeInMainWorld = vi.hoisted(() => vi.fn());
const getPathForFile = vi.hoisted(() => vi.fn(() => "/tmp/mock.pdf"));

vi.mock("electron-effect-rpc/preload", () => ({
  exposeIpcBridge,
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  webUtils: {
    getPathForFile,
  },
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("preload security", () => {
  beforeEach(() => {
    vi.resetModules();
    exposeIpcBridge.mockClear();
    exposeInMainWorld.mockClear();
    getPathForFile.mockClear();
  });

  it("uses a constrained bridge global and avoids exposing raw ipcRenderer", () => {
    const preloadSource = readFileSync(path.join(__dirname, "../../src/preload/index.ts"), "utf8");

    expect(preloadSource).toContain("exposeIpcBridge");
    expect(preloadSource).toContain('"desktopApi"');
    expect(preloadSource).toContain('"desktopHost"');
    expect(preloadSource).toContain("webUtils.getPathForFile");
    expect(preloadSource).not.toContain("ipcRenderer");
    expect(preloadSource).not.toContain('contextBridge.exposeInMainWorld("ipcRenderer"');
  });

  it("exposes only the expected preload globals at runtime", async () => {
    await import("../../src/preload/index");

    expect(exposeIpcBridge).toHaveBeenCalledWith({
      global: "desktopApi",
      channelPrefix: { rpc: "rpc/", event: "event/" },
    });

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [name, payload] = exposeInMainWorld.mock.calls[0] ?? [];

    expect(name).toBe("desktopHost");
    expect(payload).toBeDefined();

    const bridge = payload as { readonly getPathForFile: (file: File) => string };
    expect(typeof bridge.getPathForFile).toBe("function");

    const file = new File(["%PDF"], "security-test.pdf", { type: "application/pdf" });
    const resolvedPath = bridge.getPathForFile(file);

    expect(resolvedPath).toBe("/tmp/mock.pdf");
    expect(getPathForFile).toHaveBeenCalledWith(file);
  });
});
