import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import {
  RouterProvider,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { StoresProvider, createStores } from "@shared/state/stores-context";
import { DeckRow } from "@/components/deck-list/deck-row";
import type { DeckTreeLeaf, DeckTreeGroup } from "@re/workspace";

async function renderWithProviders(ui: React.ReactNode, stores = createStores()) {
  const rootRoute = createRootRoute({ component: () => ui });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  const reviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/review",
    component: () => null,
    validateSearch: (search: Record<string, unknown>) => search,
  });
  const routeTree = rootRoute.addChildren([indexRoute, reviewRoute]);
  const router = createRouter({ routeTree, history: createHashHistory() });

  const screen = await render(
    <StoresProvider stores={stores}>
      <RouterProvider router={router} />
    </StoresProvider>,
  );

  return { screen, stores, router };
}

const healthyLeaf: DeckTreeLeaf = {
  kind: "leaf",
  depth: 0,
  name: "algorithms",
  relativePath: "algorithms.md",
  snapshot: {
    absolutePath: "/workspace/algorithms.md",
    relativePath: "algorithms.md",
    name: "algorithms",
    status: "ok",
    totalCards: 5,
    dueCards: 2,
    stateCounts: { new: 1, learning: 1, review: 2, relearning: 1 },
  },
};

const errorLeaf: DeckTreeLeaf = {
  kind: "leaf",
  depth: 0,
  name: "broken",
  relativePath: "broken.md",
  snapshot: {
    absolutePath: "/workspace/broken.md",
    relativePath: "broken.md",
    name: "broken",
    status: "parse_error",
    message: "Invalid metadata at line 3",
  },
};

const groupNode: DeckTreeGroup = {
  kind: "group",
  depth: 0,
  name: "languages",
  relativePath: "languages",
  totalCards: 12,
  dueCards: 4,
  stateCounts: { new: 3, learning: 2, review: 5, relearning: 2 },
  errorCount: 0,
  children: [],
};

const groupDescendants = ["languages/rust.md", "languages/go.md"];

describe("DeckRow", () => {
  describe("leaf deck rendering", () => {
    it("renders name, state badges, due count, and total count for a healthy leaf", async () => {
      const { screen } = await renderWithProviders(
        <DeckRow node={healthyLeaf} depth={0} descendantDeckPaths={[]} />,
      );

      await expect.element(screen.getByText("algorithms")).toBeVisible();
      await expect.element(screen.getByTitle("New")).toBeVisible();
      await expect.element(screen.getByTitle("Learning", { exact: true })).toBeVisible();
      await expect.element(screen.getByTitle("Review")).toBeVisible();
      await expect.element(screen.getByTitle("Relearning")).toBeVisible();
      await expect.element(screen.getByText("2 due")).toBeVisible();
      await expect.element(screen.getByText("5", { exact: true })).toBeVisible();
    });
  });

  describe("error leaf rendering", () => {
    it("applies opacity-60 and hides stats for an error leaf", async () => {
      const { screen } = await renderWithProviders(
        <DeckRow node={errorLeaf} depth={0} descendantDeckPaths={[]} />,
      );

      await expect.element(screen.getByText("broken")).toBeVisible();

      const listitem = screen.getByRole("listitem");
      await expect.element(listitem).toHaveClass("opacity-60");

      expect(screen.getByTitle("New").query()).toBeNull();
      expect(screen.getByTitle("Learning").query()).toBeNull();
      expect(screen.getByTitle("Review").query()).toBeNull();
      expect(screen.getByTitle("Relearning").query()).toBeNull();
      expect(screen.getByText("due").query()).toBeNull();
    });
  });

  describe("group folder rendering", () => {
    it("renders name, collapse button, state badges, due count, and total count", async () => {
      const { screen } = await renderWithProviders(
        <DeckRow node={groupNode} depth={0} descendantDeckPaths={groupDescendants} />,
      );

      await expect.element(screen.getByText("languages")).toBeVisible();
      await expect.element(screen.getByRole("button", { name: "Collapse folder" })).toBeVisible();
      await expect.element(screen.getByTitle("New")).toBeVisible();
      await expect.element(screen.getByTitle("Review")).toBeVisible();
      await expect.element(screen.getByText("4 due")).toBeVisible();
      await expect.element(screen.getByText("12", { exact: true })).toBeVisible();
    });
  });

  describe("checkbox - leaf deck toggle", () => {
    it("selects and deselects a deck via checkbox click", async () => {
      const stores = createStores();
      const { screen } = await renderWithProviders(
        <DeckRow node={healthyLeaf} depth={0} descendantDeckPaths={[]} />,
        stores,
      );

      const checkbox = screen.getByRole("checkbox", { name: "Select algorithms" });

      (checkbox.element() as HTMLElement).click();
      expect(stores.deckSelection.getSnapshot().context.selected).toHaveProperty("algorithms.md");

      (checkbox.element() as HTMLElement).click();
      expect(stores.deckSelection.getSnapshot().context.selected).not.toHaveProperty(
        "algorithms.md",
      );
    });
  });

  describe("checkbox - folder toggle", () => {
    it("selects and deselects all descendant paths", async () => {
      const stores = createStores();
      const { screen } = await renderWithProviders(
        <DeckRow node={groupNode} depth={0} descendantDeckPaths={groupDescendants} />,
        stores,
      );

      const checkbox = screen.getByRole("checkbox", { name: "Select languages" });
      (checkbox.element() as HTMLElement).click();

      const selected = stores.deckSelection.getSnapshot().context.selected;
      expect(selected).toHaveProperty("languages/rust.md");
      expect(selected).toHaveProperty("languages/go.md");

      (checkbox.element() as HTMLElement).click();

      const afterDeselect = stores.deckSelection.getSnapshot().context.selected;
      expect(afterDeselect).not.toHaveProperty("languages/rust.md");
      expect(afterDeselect).not.toHaveProperty("languages/go.md");
    });
  });

  describe("checkbox - indeterminate state", () => {
    it("shows indeterminate when only some descendants are selected", async () => {
      const stores = createStores();
      stores.deckSelection.send({ type: "toggleDeck", path: "languages/rust.md" });

      const { screen } = await renderWithProviders(
        <DeckRow node={groupNode} depth={0} descendantDeckPaths={groupDescendants} />,
        stores,
      );

      const checkbox = screen.getByRole("checkbox", { name: "Select languages" });
      await expect.element(checkbox).toHaveAttribute("data-indeterminate");
    });
  });

  describe("collapse/expand toggle", () => {
    it("collapses and expands a group folder", async () => {
      const stores = createStores();
      const { screen } = await renderWithProviders(
        <DeckRow node={groupNode} depth={0} descendantDeckPaths={groupDescendants} />,
        stores,
      );

      const collapseButton = screen.getByRole("button", { name: "Collapse folder" });
      await userEvent.click(collapseButton);

      expect(stores.deckList.getSnapshot().context.collapsed).toHaveProperty("languages");

      await expect.element(screen.getByRole("button", { name: "Expand folder" })).toBeVisible();

      await userEvent.click(screen.getByRole("button", { name: "Expand folder" }));

      expect(stores.deckList.getSnapshot().context.collapsed).not.toHaveProperty("languages");

      await expect.element(screen.getByRole("button", { name: "Collapse folder" })).toBeVisible();
    });
  });

  describe("navigation - deck name click", () => {
    it("navigates to /review with the deck path when name is clicked", async () => {
      const stores = createStores();
      const { screen, router } = await renderWithProviders(
        <DeckRow node={healthyLeaf} depth={0} descendantDeckPaths={[]} />,
        stores,
      );

      await userEvent.click(screen.getByText("algorithms"));

      await expect.poll(() => router.state.location.pathname).toBe("/review");
    });
  });

  describe("navigation - folder name click", () => {
    it("navigates to /review with descendant paths when folder name is clicked", async () => {
      const stores = createStores();
      const { screen, router } = await renderWithProviders(
        <DeckRow node={groupNode} depth={0} descendantDeckPaths={groupDescendants} />,
        stores,
      );

      await userEvent.click(screen.getByText("languages"));

      await expect.poll(() => router.state.location.pathname).toBe("/review");
    });
  });

  describe("navigation - folder with zero descendants", () => {
    it("does not navigate when folder has no descendants", async () => {
      const stores = createStores();
      const { screen, router } = await renderWithProviders(
        <DeckRow node={groupNode} depth={0} descendantDeckPaths={[]} />,
        stores,
      );

      const initialPathname = router.state.location.pathname;

      await userEvent.click(screen.getByText("languages"));

      expect(router.state.location.pathname).toBe(initialPathname);
    });
  });
});
