import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createHashHistory, createRouter } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../src/renderer/src/routeTree.gen";

describe("renderer integration", () => {
  afterEach(() => {
    cleanup();
  });

  it("loads settings, scans with workspace root, and supports save/clear root actions", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
      if (method === "GetBootstrapData") {
        return {
          type: "success",
          data: {
            appName: "re Desktop",
            message: "Renderer connected to main through typed Effect RPC",
            timestamp: "2026-02-15T00:00:00.000Z",
          },
        };
      }

      if (method === "GetSettings") {
        return {
          type: "success",
          data: {
            settingsVersion: 1,
            workspace: {
              rootPath: "/Users/joaoeira/Documents/deck",
            },
          },
        };
      }

      if (method === "SetWorkspaceRootPath") {
        const rootPath = (
          payload as {
            rootPath: string | null;
          }
        ).rootPath;

        return {
          type: "success",
          data: {
            settingsVersion: 1,
            workspace: { rootPath },
          },
        };
      }

      if (method === "ParseDeckPreview") {
        return {
          type: "success",
          data: {
            items: 2,
            cards: 2,
          },
        };
      }

      if (method === "ScanDecks") {
        return {
          type: "success",
          data: {
            rootPath: (
              payload as {
                rootPath: string;
              }
            ).rootPath,
            decks: [
              {
                absolutePath: "/Users/joaoeira/Documents/deck/nested/child.md",
                relativePath: "nested/child.md",
                name: "child",
              },
              {
                absolutePath: "/Users/joaoeira/Documents/deck/root.md",
                relativePath: "root.md",
                name: "root",
              },
            ],
          },
        };
      }

      return {
        type: "failure",
        error: {
          code: "UNKNOWN_METHOD",
          message: method,
        },
      };
    });

    const subscribe = vi.fn().mockReturnValue(() => undefined);

    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: { invoke, subscribe },
    });

    const router = createRouter({
      routeTree,
      history: createHashHistory(),
    });

    render(<RouterProvider router={router} />);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("GetBootstrapData", {}));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("GetSettings", {}));

    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("ParseDeckPreview", expect.objectContaining({ markdown: expect.any(String) })),
    );

    fireEvent.click(screen.getByRole("button", { name: "Scan Decks" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("ScanDecks", {
        rootPath: "/Users/joaoeira/Documents/deck",
      }),
    );

    fireEvent.change(screen.getByPlaceholderText("/absolute/path/to/workspace"), {
      target: { value: "/Users/joaoeira/Documents/deck/new-root" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Root Path" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("SetWorkspaceRootPath", {
        rootPath: "/Users/joaoeira/Documents/deck/new-root",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear Root Path" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("SetWorkspaceRootPath", {
        rootPath: null,
      }),
    );

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Scan Decks" }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );

    expect(screen.getByText("Desktop App Shell")).toBeTruthy();
    expect(screen.getByText("Items:")).toBeTruthy();
    expect(screen.getByText("Cards:")).toBeTruthy();
    expect(screen.getByText("Total Decks:")).toBeTruthy();
  });

  it("shows settings read error and disables settings-dependent actions", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "GetBootstrapData") {
        return {
          type: "success",
          data: {
            appName: "re Desktop",
            message: "Renderer connected to main through typed Effect RPC",
            timestamp: "2026-02-15T00:00:00.000Z",
          },
        };
      }

      if (method === "GetSettings") {
        return {
          type: "failure",
          error: {
            tag: "SettingsDecodeFailed",
            data: {
              _tag: "SettingsDecodeFailed",
              path: "/tmp/settings.json",
              message: "invalid JSON",
            },
          },
        };
      }

      if (method === "ParseDeckPreview") {
        return {
          type: "success",
          data: {
            items: 2,
            cards: 2,
          },
        };
      }

      return {
        type: "failure",
        error: {
          code: "UNKNOWN_METHOD",
          message: method,
        },
      };
    });

    const subscribe = vi.fn().mockReturnValue(() => undefined);

    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: { invoke, subscribe },
    });

    const router = createRouter({
      routeTree,
      history: createHashHistory(),
    });

    render(<RouterProvider router={router} />);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("GetSettings", {}));
    await waitFor(() =>
      expect(screen.getByText(/Settings file is invalid/)).toBeTruthy(),
    );

    expect(
      (screen.getByRole("button", { name: "Save Root Path" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Clear Root Path" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Scan Decks" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Analyze" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
