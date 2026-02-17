import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createHashHistory, createRouter } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../src/renderer/src/routeTree.gen";

describe("renderer integration", () => {
  afterEach(() => {
    cleanup();
  });

  it("loads and refreshes workspace snapshots after settings/root updates", async () => {
    const makeSnapshot = (rootPath: string) => ({
      rootPath,
      decks: [
        {
          absolutePath: `${rootPath}/ok.md`,
          relativePath: "ok.md",
          name: "ok",
          status: "ok" as const,
          totalCards: 3,
          stateCounts: {
            new: 1,
            learning: 1,
            review: 1,
            relearning: 0,
          },
        },
        {
          absolutePath: `${rootPath}/read.md`,
          relativePath: "read.md",
          name: "read",
          status: "read_error" as const,
          message: "Permission denied",
        },
        {
          absolutePath: `${rootPath}/parse.md`,
          relativePath: "parse.md",
          name: "parse",
          status: "parse_error" as const,
          message: "Invalid metadata at line 1: malformed",
        },
      ],
    });

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

      if (method === "GetWorkspaceSnapshot") {
        const rootPath = (
          payload as {
            rootPath: string;
          }
        ).rootPath;

        return {
          type: "success",
          data: makeSnapshot(rootPath),
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

      return {
        type: "failure",
        error: {
          code: "UNKNOWN_METHOD",
          message: method,
        },
      };
    });

    const expectSummaryRow = (text: string) =>
      expect(
        screen.getByText((_, element) =>
          element?.textContent?.replace(/\s+/g, " ").trim() === text,
        ),
      ).toBeTruthy();

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
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("GetWorkspaceSnapshot", {
        rootPath: "/Users/joaoeira/Documents/deck",
        options: {
          includeHidden: false,
          extraIgnorePatterns: [],
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("ParseDeckPreview", expect.objectContaining({ markdown: expect.any(String) })),
    );

    expect(screen.queryByRole("button", { name: "Scan Decks" })).toBeNull();
    await waitFor(() => expectSummaryRow("Total Decks: 3"));
    expectSummaryRow("OK Decks: 1");
    expectSummaryRow("Read Errors: 1");
    expectSummaryRow("Parse Errors: 1");
    expectSummaryRow("Cards (OK decks): 3");
    expectSummaryRow("New: 1");
    expectSummaryRow("Learning: 1");
    expectSummaryRow("Review: 1");
    expectSummaryRow("Relearning: 0");

    fireEvent.change(screen.getByPlaceholderText("/absolute/path/to/workspace"), {
      target: { value: "/Users/joaoeira/Documents/deck/new-root" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Root Path" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("SetWorkspaceRootPath", {
        rootPath: "/Users/joaoeira/Documents/deck/new-root",
      }),
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("GetWorkspaceSnapshot", {
        rootPath: "/Users/joaoeira/Documents/deck/new-root",
        options: {
          includeHidden: false,
          extraIgnorePatterns: [],
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear Root Path" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("SetWorkspaceRootPath", {
        rootPath: null,
      }),
    );
    await waitFor(() => expect(screen.getByText("Root: (unset)")).toBeTruthy());
    expect(screen.queryByText(/Resolved Root:/)).toBeNull();

    expect(screen.getByText("Desktop App Shell")).toBeTruthy();
    expect(screen.getByText("Items:")).toBeTruthy();
    expect(screen.getByText("Cards:")).toBeTruthy();
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
      (screen.getByRole("button", { name: "Analyze" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      invoke.mock.calls.some(([method]) => method === "GetWorkspaceSnapshot"),
    ).toBe(false);
  });
});
