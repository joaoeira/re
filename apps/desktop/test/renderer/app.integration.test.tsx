import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createHashHistory, createRouter } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../src/renderer/src/routeTree.gen";

describe("renderer integration", () => {
  afterEach(() => {
    cleanup();
  });

  it("loads workspace snapshot and renders deck list", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
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
        const rootPath = (payload as { rootPath: string }).rootPath;
        return {
          type: "success",
          data: {
            rootPath,
            decks: [
              {
                absolutePath: `${rootPath}/ok.md`,
                relativePath: "ok.md",
                name: "ok",
                status: "ok" as const,
                totalCards: 3,
                stateCounts: { new: 1, learning: 1, review: 1, relearning: 0 },
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
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    const eventHandlers = new Map<string, (payload: unknown) => void>();
    const subscribe = vi
      .fn()
      .mockImplementation((name: string, handler: (payload: unknown) => void) => {
        eventHandlers.set(name, handler);
        return () => {
          eventHandlers.delete(name);
        };
      });

    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: { invoke, subscribe },
    });

    const router = createRouter({ routeTree, history: createHashHistory() });
    render(<RouterProvider router={router} />);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("GetSettings", {}));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("GetWorkspaceSnapshot", {
        rootPath: "/Users/joaoeira/Documents/deck",
        options: { includeHidden: false, extraIgnorePatterns: [] },
      }),
    );

    expect(screen.getByText("ok")).toBeTruthy();
    expect(screen.getByText("read")).toBeTruthy();
    expect(screen.getByText("parse")).toBeTruthy();
  });

  it("updates deck list when WorkspaceSnapshotChanged event fires", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "GetSettings") {
        return {
          type: "success",
          data: {
            settingsVersion: 1,
            workspace: { rootPath: "/workspace" },
          },
        };
      }

      if (method === "GetWorkspaceSnapshot") {
        return {
          type: "success",
          data: {
            rootPath: "/workspace",
            decks: [
              {
                absolutePath: "/workspace/deck.md",
                relativePath: "deck.md",
                name: "deck",
                status: "ok" as const,
                totalCards: 1,
                stateCounts: { new: 1, learning: 0, review: 0, relearning: 0 },
              },
            ],
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    const eventHandlers = new Map<string, (payload: unknown) => void>();
    const subscribe = vi
      .fn()
      .mockImplementation((name: string, handler: (payload: unknown) => void) => {
        eventHandlers.set(name, handler);
        return () => {
          eventHandlers.delete(name);
        };
      });

    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: { invoke, subscribe },
    });

    const router = createRouter({ routeTree, history: createHashHistory() });
    render(<RouterProvider router={router} />);

    await waitFor(() => expect(screen.getByText("deck")).toBeTruthy());
    expect(screen.queryByText("new-deck")).toBeNull();

    const handler = eventHandlers.get("WorkspaceSnapshotChanged");
    expect(handler).toBeDefined();

    handler!({
      rootPath: "/workspace",
      decks: [
        {
          absolutePath: "/workspace/deck.md",
          relativePath: "deck.md",
          name: "deck",
          status: "ok",
          totalCards: 5,
          stateCounts: { new: 2, learning: 1, review: 1, relearning: 1 },
        },
        {
          absolutePath: "/workspace/new-deck.md",
          relativePath: "new-deck.md",
          name: "new-deck",
          status: "ok",
          totalCards: 3,
          stateCounts: { new: 3, learning: 0, review: 0, relearning: 0 },
        },
      ],
    });

    await waitFor(() => expect(screen.getByText("new-deck")).toBeTruthy());
    expect(screen.getByText("deck")).toBeTruthy();
  });

  it("shows error when settings fail to load", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string) => {
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

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    const subscribe = vi.fn().mockReturnValue(() => undefined);

    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: { invoke, subscribe },
    });

    const router = createRouter({ routeTree, history: createHashHistory() });
    render(<RouterProvider router={router} />);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("GetSettings", {}));
    await waitFor(() => expect(screen.getByText(/Settings file is invalid/)).toBeTruthy());

    expect(invoke.mock.calls.some(([method]: [string]) => method === "GetWorkspaceSnapshot")).toBe(
      false,
    );
  });
});
