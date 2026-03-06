import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  Outlet,
  RouterProvider,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

import { ReviewSession } from "@/components/review-session/review-session";
import { QueryClientProvider } from "@tanstack/react-query";
import { IpcProvider } from "@/lib/ipc-context";
import { createQueryClient } from "@/lib/query-client";
import { mockDesktopGlobals } from "./forge-test-helpers";

const REVIEW_ROOT_PATH = "/workspace";
const REVIEW_DECK_PATH = `${REVIEW_ROOT_PATH}/deck.md`;

type InvokeMock = ReturnType<typeof vi.fn> & ((...args: unknown[]) => Promise<unknown>);

const renderReviewSession = async (options?: {
  readonly invoke?: InvokeMock;
  readonly eventHandlers?: Map<string, (payload: unknown) => void>;
}) => {
  const eventHandlers = options?.eventHandlers ?? new Map<string, (payload: unknown) => void>();
  const invoke: InvokeMock =
    options?.invoke ??
    vi.fn().mockImplementation(async (method: string) => {
      if (method === "GetSettings") {
        return {
          type: "success",
          data: {
            settingsVersion: 1,
            workspace: { rootPath: REVIEW_ROOT_PATH },
          },
        };
      }

      if (method === "GetWorkspaceSnapshot") {
        return {
          type: "success",
          data: {
            rootPath: REVIEW_ROOT_PATH,
            asOf: "2025-01-10T00:00:00.000Z",
            decks: [
              {
                absolutePath: REVIEW_DECK_PATH,
                relativePath: "deck.md",
                name: "deck",
                status: "ok" as const,
                totalCards: 1,
                dueCards: 1,
                stateCounts: { new: 1, learning: 0, review: 0, relearning: 0 },
              },
            ],
          },
        };
      }

      if (method === "BuildReviewQueue") {
        return {
          type: "success",
          data: {
            items: [
              {
                deckPath: REVIEW_DECK_PATH,
                cardId: "qa-card",
                cardIndex: 0,
                deckName: "deck",
              },
            ],
            totalNew: 1,
            totalDue: 0,
          },
        };
      }

      if (method === "GetCardContent") {
        return {
          type: "success",
          data: {
            prompt: "Question",
            reveal: "Answer",
            cardType: "qa" as const,
          },
        };
      }

      if (method === "GetReviewAssistantSourceCard") {
        return {
          type: "success",
          data: {
            sourceCard: {
              cardType: "qa" as const,
              content: {
                question: "Question",
                answer: "Answer",
              },
            },
          },
        };
      }

      if (method === "ReviewGeneratePermutations") {
        return {
          type: "success",
          data: {
            permutations: [
              {
                id: "perm-1",
                question: "Variant question",
                answer: "Variant answer",
              },
            ],
          },
        };
      }

      if (method === "AppendItem") {
        return {
          type: "success",
          data: {
            cardIds: ["new-card"],
          },
        };
      }

      if (method === "DeleteItems" || method === "OpenEditorWindow") {
        return {
          type: "success",
          data: {},
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

  const subscribe = vi
    .fn()
    .mockImplementation((name: string, handler: (payload: unknown) => void) => {
      eventHandlers.set(name, handler);
      return () => {
        eventHandlers.delete(name);
      };
    });

  mockDesktopGlobals(invoke, undefined, subscribe);
  window.location.hash = "#/review";

  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <div>Home</div>,
  });
  const reviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/review",
    component: () => <ReviewSession decks="all" />,
  });
  const routeTree = rootRoute.addChildren([homeRoute, reviewRoute]);
  const router = createRouter({ routeTree, history: createHashHistory() });

  const screen = await render(
    <QueryClientProvider client={createQueryClient()}>
      <IpcProvider>
        <RouterProvider router={router} />
      </IpcProvider>
    </QueryClientProvider>,
  );

  await expect.element(screen.getByText("Show Answer")).toBeVisible();

  return { screen, invoke, eventHandlers };
};

describe("ReviewSession permutations assistant", () => {
  it("opens the command dialog and suppresses reveal while a sidebar button is focused", async () => {
    const { invoke } = await renderReviewSession();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    await expect.element(page.getByText("Review actions")).toBeVisible();

    (page.getByRole("button", { name: /Create permutations/i }).element() as HTMLElement).click();

    await expect
      .element(page.getByLabelText("Permutations sidebar", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("Variant question")).toBeVisible();

    const regenerateButton = page.getByRole("button", { name: "Regenerate" });
    (regenerateButton.element() as HTMLElement).focus();
    (regenerateButton.element() as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    );

    await expect.element(page.getByText("Show Answer")).toBeVisible();
    expect(page.getByText("Again").query()).toBeNull();
    expect(
      invoke.mock.calls.filter(([method]: unknown[]) => method === "ReviewGeneratePermutations"),
    ).toHaveLength(1);
  });

  it("resets and refetches the source-card query when the current card reloads", async () => {
    const eventHandlers = new Map<string, (payload: unknown) => void>();
    const { invoke } = await renderReviewSession({ eventHandlers });

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.element(page.getByText("Review actions")).toBeVisible();
    (page.getByRole("button", { name: /Create permutations/i }).element() as HTMLElement).click();

    await expect
      .element(page.getByLabelText("Permutations sidebar", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("Variant question")).toBeVisible();
    const sourceCardCallsBeforeEdit = invoke.mock.calls.filter(
      ([method]: unknown[]) => method === "GetReviewAssistantSourceCard",
    ).length;
    expect(sourceCardCallsBeforeEdit).toBe(1);

    const onCardEdited = eventHandlers.get("CardEdited");
    expect(onCardEdited).toBeDefined();
    onCardEdited?.({
      deckPath: REVIEW_DECK_PATH,
      cardId: "qa-card",
    });

    await expect
      .poll(() => page.getByLabelText("Permutations sidebar", { exact: true }).query())
      .toBeNull();

    const sourceCardCallsAfterEdit = invoke.mock.calls.filter(
      ([method]: unknown[]) => method === "GetReviewAssistantSourceCard",
    ).length;
    expect(sourceCardCallsAfterEdit).toBe(sourceCardCallsBeforeEdit);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.element(page.getByText("Review actions")).toBeVisible();
    (page.getByRole("button", { name: /Create permutations/i }).element() as HTMLElement).click();
    await expect
      .element(page.getByLabelText("Permutations sidebar", { exact: true }))
      .toBeVisible();

    expect(
      invoke.mock.calls.filter(([method]: unknown[]) => method === "GetReviewAssistantSourceCard"),
    ).toHaveLength(2);
  });
});
