import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createHashHistory, createRouter } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

import { routeTree } from "../../src/renderer/src/routeTree.gen";

describe("renderer integration", () => {
  it("renders route and invokes both bootstrap and deck preview RPC methods", async () => {
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

    expect(screen.getByText("Desktop App Shell")).toBeTruthy();
    expect(screen.getByText("Items:")).toBeTruthy();
    expect(screen.getByText("Cards:")).toBeTruthy();
  });
});
