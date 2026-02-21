import { render } from "vitest-browser-react";
import { RouterProvider, createHashHistory, createRouter } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

import { StoresProvider, createStores } from "@shared/state/stores-context";
import { routeTree } from "../../src/renderer/src/routeTree.gen";

const mockDesktopApi = (
  invoke: (...args: unknown[]) => Promise<unknown>,
  subscribe: (...args: unknown[]) => () => void,
) => {
  Object.defineProperty(window, "desktopApi", {
    configurable: true,
    value: { invoke, subscribe },
  });
};

const renderApp = async (stores: ReturnType<typeof createStores>) => {
  const router = createRouter({ routeTree, history: createHashHistory() });
  return render(
    <StoresProvider stores={stores}>
      <RouterProvider router={router} />
    </StoresProvider>,
  );
};

describe("renderer integration", () => {
  it("loads workspace snapshot and renders deck list", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
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
        const rootPath = (payload as { rootPath: string }).rootPath;
        return {
          type: "success",
          data: {
            rootPath,
            asOf: "2025-01-10T00:00:00.000Z",
            decks: [
              {
                absolutePath: `${rootPath}/ok.md`,
                relativePath: "ok.md",
                name: "ok",
                status: "ok" as const,
                totalCards: 3,
                dueCards: 2,
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

    const subscribe = vi.fn().mockImplementation((_name: string, _handler: unknown) => {
      return () => undefined;
    });

    mockDesktopApi(invoke, subscribe);

    const stores = createStores();
    const screen = await renderApp(stores);

    await expect.element(screen.getByText("ok")).toBeVisible();
    await expect.element(screen.getByText("read")).toBeVisible();
    await expect.element(screen.getByText("parse")).toBeVisible();
    await expect.element(screen.getByText("2 due")).toBeVisible();
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
            asOf: "2025-01-10T00:00:00.000Z",
            decks: [
              {
                absolutePath: "/workspace/deck.md",
                relativePath: "deck.md",
                name: "deck",
                status: "ok" as const,
                totalCards: 1,
                dueCards: 0,
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

    mockDesktopApi(invoke, subscribe);

    const stores = createStores();
    const screen = await renderApp(stores);

    await expect.element(screen.getByText("deck", { exact: true })).toBeVisible();
    expect(screen.getByText("new-deck").query()).toBeNull();

    const handler = eventHandlers.get("WorkspaceSnapshotChanged");
    expect(handler).toBeDefined();

    handler!({
      rootPath: "/workspace",
      asOf: "2025-01-10T12:00:00.000Z",
      decks: [
        {
          absolutePath: "/workspace/deck.md",
          relativePath: "deck.md",
          name: "deck",
          status: "ok",
          totalCards: 5,
          dueCards: 1,
          stateCounts: { new: 2, learning: 1, review: 1, relearning: 1 },
        },
        {
          absolutePath: "/workspace/new-deck.md",
          relativePath: "new-deck.md",
          name: "new-deck",
          status: "ok",
          totalCards: 3,
          dueCards: 0,
          stateCounts: { new: 3, learning: 0, review: 0, relearning: 0 },
        },
      ],
    });

    await expect.element(screen.getByText("new-deck")).toBeVisible();
    await expect.element(screen.getByText("deck", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("1 due")).toBeVisible();
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
    mockDesktopApi(invoke, subscribe);

    const stores = createStores();
    const screen = await renderApp(stores);

    await expect.element(screen.getByText(/Settings file is invalid/)).toBeVisible();
  });

  it("shows message when no workspace is configured", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "GetSettings") {
        return {
          type: "success",
          data: {
            settingsVersion: 1,
            workspace: { rootPath: null },
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    const subscribe = vi.fn().mockReturnValue(() => undefined);
    mockDesktopApi(invoke, subscribe);

    const stores = createStores();
    const screen = await renderApp(stores);

    await expect
      .element(screen.getByText("No workspace configured. Set a workspace root path in settings."))
      .toBeVisible();
  });

  it("shows message when workspace has no decks", async () => {
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
            asOf: "2025-01-10T00:00:00.000Z",
            decks: [],
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    const subscribe = vi.fn().mockReturnValue(() => undefined);
    mockDesktopApi(invoke, subscribe);

    const stores = createStores();
    const screen = await renderApp(stores);

    await expect.element(screen.getByText("No decks found in this workspace.")).toBeVisible();
  });

  it("renders folder structure with group nodes for nested decks", async () => {
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
            asOf: "2025-01-10T00:00:00.000Z",
            decks: [
              {
                absolutePath: "/workspace/folder/a.md",
                relativePath: "folder/a.md",
                name: "a",
                status: "ok" as const,
                totalCards: 5,
                dueCards: 2,
                stateCounts: { new: 1, learning: 1, review: 1, relearning: 0 },
              },
              {
                absolutePath: "/workspace/folder/b.md",
                relativePath: "folder/b.md",
                name: "b",
                status: "ok" as const,
                totalCards: 3,
                dueCards: 1,
                stateCounts: { new: 1, learning: 0, review: 1, relearning: 0 },
              },
            ],
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    const subscribe = vi.fn().mockReturnValue(() => undefined);
    mockDesktopApi(invoke, subscribe);

    const stores = createStores();
    const screen = await renderApp(stores);

    await expect.element(screen.getByText("folder")).toBeVisible();
    await expect.element(screen.getByText("a", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("b", { exact: true })).toBeVisible();
  });

  it("shows toolbar with Review button when decks have reviewable cards", async () => {
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
            asOf: "2025-01-10T00:00:00.000Z",
            decks: [
              {
                absolutePath: "/workspace/deck.md",
                relativePath: "deck.md",
                name: "deck",
                status: "ok" as const,
                totalCards: 10,
                dueCards: 3,
                stateCounts: { new: 2, learning: 1, review: 1, relearning: 0 },
              },
            ],
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    const subscribe = vi.fn().mockReturnValue(() => undefined);
    mockDesktopApi(invoke, subscribe);

    const stores = createStores();
    const screen = await renderApp(stores);

    await expect.element(screen.getByText("deck", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Review")).toBeVisible();
  });

  it("hides toolbar when no decks have reviewable cards", async () => {
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
            asOf: "2025-01-10T00:00:00.000Z",
            decks: [
              {
                absolutePath: "/workspace/deck.md",
                relativePath: "deck.md",
                name: "deck",
                status: "ok" as const,
                totalCards: 5,
                dueCards: 0,
                stateCounts: { new: 0, learning: 0, review: 0, relearning: 0 },
              },
            ],
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    const subscribe = vi.fn().mockReturnValue(() => undefined);
    mockDesktopApi(invoke, subscribe);

    const stores = createStores();
    const screen = await renderApp(stores);

    await expect.element(screen.getByText("deck", { exact: true })).toBeVisible();
    expect(screen.getByText("Review").query()).toBeNull();
  });
});
