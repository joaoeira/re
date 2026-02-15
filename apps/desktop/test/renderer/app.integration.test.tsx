import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createHashHistory, createRouter } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

import { routeTree } from "../../src/renderer/src/routeTree.gen";

describe("renderer integration", () => {
  it("renders route and invokes bootstrap, preview, and scan RPC methods", async () => {
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
            rootPath: "/Users/joaoeira/Documents/deck",
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

    expect(screen.getByText("Desktop App Shell")).toBeTruthy();
    expect(screen.getByText("Items:")).toBeTruthy();
    expect(screen.getByText("Cards:")).toBeTruthy();
    expect(screen.getByText("Total Decks:")).toBeTruthy();
  });
});
