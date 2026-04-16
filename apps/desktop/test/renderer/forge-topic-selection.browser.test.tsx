import { userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";

import { ForgePage } from "@/components/forge/forge-page";
import { renderWithIpcProviders } from "./render-with-providers";
import { createForgeInvoke, DEFAULT_FORGE_TOPICS_BY_CHUNK } from "./forge-ipc-mocks";
import { mockDesktopGlobals, uploadPdf } from "./forge-test-helpers";

const TOPICS_BY_CHUNK = DEFAULT_FORGE_TOPICS_BY_CHUNK.map((chunk, index) => ({
  ...chunk,
  sequenceOrder: index + 1,
}));

const createSuccessInvoke = (topicsByChunk = TOPICS_BY_CHUNK) =>
  createForgeInvoke({
    topicsByChunk,
  });

const renderForgePage = async () => renderWithIpcProviders(<ForgePage />);

const navigateToTopics = async (screen: Awaited<ReturnType<typeof renderForgePage>>) => {
  await uploadPdf();
  await userEvent.click(screen.getByText("Begin Extraction"));
  await expect.element(screen.getByText("Select topics")).toBeVisible();
};

const selectAllButton = (screen: Awaited<ReturnType<typeof renderForgePage>>) =>
  screen.getByRole("button", { name: "Select all", exact: true });

const deselectAllButton = (screen: Awaited<ReturnType<typeof renderForgePage>>) =>
  screen.getByRole("button", { name: "Deselect all", exact: true });

describe("TopicSelection", () => {
  describe("rendering", () => {
    it("shows heading and description after extraction", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      await expect.element(screen.getByText("Select topics")).toBeVisible();
      await expect
        .element(
          screen.getByText(
            "Choose which topics to generate flashcards for. Each topic typically produces 5-7 cards.",
          ),
        )
        .toBeVisible();
    });

    it("shows chunk headers with sequence order", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      await expect.element(screen.getByText("Chunk 1")).toBeVisible();
      await expect.element(screen.getByText("Chunk 2")).toBeVisible();
    });

    it("shows all topic texts", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      await expect.element(screen.getByText("biology")).toBeVisible();
      await expect.element(screen.getByText("cells")).toBeVisible();
      await expect.element(screen.getByText("membranes")).toBeVisible();
    });

    it("shows Select all and Deselect all buttons", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      await expect.element(selectAllButton(screen)).toBeVisible();
      await expect.element(deselectAllButton(screen)).toBeVisible();
    });

    it("shows the disabled Continue to cards button", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      await expect.element(screen.getByText("Continue to cards")).toBeVisible();
      await expect
        .element(screen.getByText("Continue to cards").element().closest("button")!)
        .toBeDisabled();
    });

    it("shows the empty-state footer message", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      await expect.element(screen.getByText("Select at least 1 topic to continue")).toBeVisible();
    });

    it("shows extract summary line", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      await expect.element(screen.getByText(/Extracted.*3.*topics from.*2.*chunks/)).toBeVisible();
    });

    it("hides source step elements after transitioning to topics", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      expect(screen.getByText("Begin Extraction").query()).toBeNull();
      expect(screen.getByText(/Estimated.*chunk\(s\)/).query()).toBeNull();
    });
  });

  describe("single topic toggle", () => {
    it("selects a topic when clicking its text", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      (screen.getByText("biology").element() as HTMLElement).click();

      await expect.element(screen.getByText("1 topic selected")).toBeVisible();
      await expect.element(screen.getByText("~7 cards estimated")).toBeVisible();
    });

    it("deselects a topic when clicking it again", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      (screen.getByText("biology").element() as HTMLElement).click();
      await expect.element(screen.getByText("1 topic selected")).toBeVisible();

      (screen.getByText("biology").element() as HTMLElement).click();
      await expect.element(screen.getByText("Select at least 1 topic to continue")).toBeVisible();
    });

    it("tracks selections across multiple chunks", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      (screen.getByText("biology").element() as HTMLElement).click();
      (screen.getByText("membranes").element() as HTMLElement).click();

      await expect.element(screen.getByText("2 topics selected")).toBeVisible();
      await expect.element(screen.getByText("~14 cards estimated")).toBeVisible();
    });
  });

  describe("chunk-level checkbox", () => {
    it("selects all topics in a chunk via the chunk checkbox", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      const chunkCheckbox = screen.getByRole("checkbox", {
        name: "Select all topics in chunk 1",
      });
      (chunkCheckbox.element() as HTMLElement).click();

      await expect.element(screen.getByText("2 topics selected")).toBeVisible();
    });

    it("deselects all topics in a chunk when chunk checkbox is unchecked", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      const chunkCheckbox = screen.getByRole("checkbox", {
        name: "Select all topics in chunk 1",
      });
      (chunkCheckbox.element() as HTMLElement).click();
      await expect.element(screen.getByText("2 topics selected")).toBeVisible();

      (chunkCheckbox.element() as HTMLElement).click();
      await expect.element(screen.getByText("Select at least 1 topic to continue")).toBeVisible();
    });

    it("does not affect other chunks when toggling a chunk checkbox", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      (screen.getByText("membranes").element() as HTMLElement).click();
      await expect.element(screen.getByText("1 topic selected")).toBeVisible();

      const chunk1Checkbox = screen.getByRole("checkbox", {
        name: "Select all topics in chunk 1",
      });
      (chunk1Checkbox.element() as HTMLElement).click();

      await expect.element(screen.getByText("3 topics selected")).toBeVisible();

      (chunk1Checkbox.element() as HTMLElement).click();

      await expect.element(screen.getByText("1 topic selected")).toBeVisible();
    });

    it("shows checked state when all chunk topics are selected", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      const chunkCheckbox = screen.getByRole("checkbox", {
        name: "Select all topics in chunk 1",
      });
      (chunkCheckbox.element() as HTMLElement).click();
      await expect.element(screen.getByText("2 topics selected")).toBeVisible();

      const el = chunkCheckbox.element() as HTMLElement;
      expect(el.getAttribute("data-checked")).not.toBeNull();
      expect(el.getAttribute("data-indeterminate")).toBeNull();
    });

    it("shows indeterminate state when some chunk topics are selected", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      (screen.getByText("biology").element() as HTMLElement).click();
      await expect.element(screen.getByText("1 topic selected")).toBeVisible();

      const el = screen
        .getByRole("checkbox", { name: "Select all topics in chunk 1" })
        .element() as HTMLElement;
      expect(el.getAttribute("data-indeterminate")).not.toBeNull();
      expect(el.getAttribute("data-checked")).toBeNull();
    });

    it("shows unchecked state when no chunk topics are selected", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      const el = screen
        .getByRole("checkbox", { name: "Select all topics in chunk 1" })
        .element() as HTMLElement;
      expect(el.getAttribute("data-checked")).toBeNull();
      expect(el.getAttribute("data-indeterminate")).toBeNull();
    });
  });

  describe("bulk actions", () => {
    it("Select all selects every topic", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      await userEvent.click(selectAllButton(screen));

      await expect.element(screen.getByText("3 topics selected")).toBeVisible();
      await expect.element(screen.getByText("~21 cards estimated")).toBeVisible();
    });

    it("Deselect all clears the selection", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      await userEvent.click(selectAllButton(screen));
      await expect.element(screen.getByText("3 topics selected")).toBeVisible();

      await userEvent.click(deselectAllButton(screen));
      await expect.element(screen.getByText("Select at least 1 topic to continue")).toBeVisible();
    });

    it("Select all after partial selection selects everything", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      (screen.getByText("biology").element() as HTMLElement).click();
      await expect.element(screen.getByText("1 topic selected")).toBeVisible();

      await userEvent.click(selectAllButton(screen));
      await expect.element(screen.getByText("3 topics selected")).toBeVisible();
    });
  });

  describe("toolbar selected badge", () => {
    it("shows N selected in toolbar when topics are selected", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      (screen.getByText("biology").element() as HTMLElement).click();
      await expect.element(screen.getByText("1 selected")).toBeVisible();
    });

    it("hides the badge when all topics are deselected", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      (screen.getByText("biology").element() as HTMLElement).click();
      await expect.element(screen.getByText("1 selected")).toBeVisible();

      (screen.getByText("biology").element() as HTMLElement).click();
      await expect.element(screen.getByText("Select at least 1 topic to continue")).toBeVisible();
      expect(screen.getByText("1 selected").query()).toBeNull();
    });
  });

  describe("collapse/expand", () => {
    it("hides topics when clicking the chunk header", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      await expect.element(screen.getByText("biology")).toBeVisible();

      await userEvent.click(screen.getByText("Chunk 1"));

      await expect.poll(() => screen.getByText("biology").query()).toBeNull();
      expect(screen.getByText("cells").query()).toBeNull();
      await expect.element(screen.getByText("membranes")).toBeVisible();
    });

    it("shows topics again when clicking the chunk header a second time", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      await userEvent.click(screen.getByText("Chunk 1"));
      await expect.poll(() => screen.getByText("biology").query()).toBeNull();

      await userEvent.click(screen.getByText("Chunk 1"));
      await expect.element(screen.getByText("biology")).toBeVisible();
      await expect.element(screen.getByText("cells")).toBeVisible();
    });

    it("preserves selections after collapse and expand", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      (screen.getByText("biology").element() as HTMLElement).click();
      await expect.element(screen.getByText("1 topic selected")).toBeVisible();

      await userEvent.click(screen.getByText("Chunk 1"));
      await expect.poll(() => screen.getByText("biology").query()).toBeNull();

      await userEvent.click(screen.getByText("Chunk 1"));
      await expect.element(screen.getByText("biology")).toBeVisible();

      await expect.element(screen.getByText("1 topic selected")).toBeVisible();
    });
  });

  describe("footer", () => {
    it("pluralizes correctly for 1 topic", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      (screen.getByText("biology").element() as HTMLElement).click();
      await expect.element(screen.getByText("1 topic selected")).toBeVisible();
    });

    it("pluralizes correctly for multiple topics", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      (screen.getByText("biology").element() as HTMLElement).click();
      (screen.getByText("cells").element() as HTMLElement).click();
      await expect.element(screen.getByText("2 topics selected")).toBeVisible();
    });

    it("shows card estimate as count * 7", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      await userEvent.click(selectAllButton(screen));
      await expect.element(screen.getByText("~21 cards estimated")).toBeVisible();
    });

    it("Continue to cards button enables when topics are selected", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      await expect
        .element(screen.getByText("Continue to cards").element().closest("button")!)
        .toBeDisabled();

      await userEvent.click(selectAllButton(screen));

      await expect
        .element(screen.getByText("Continue to cards").element().closest("button")!)
        .toBeEnabled();
    });
  });

  describe("many chunks", () => {
    it("renders all chunks when there are many", async () => {
      const manyChunks = Array.from({ length: 8 }, (_, i) => ({
        chunkId: 100 + i,
        sequenceOrder: i + 1,
        topics: [`topic-${i}-a`, `topic-${i}-b`],
      }));
      mockDesktopGlobals(createSuccessInvoke(manyChunks));
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      for (let i = 1; i <= 8; i++) {
        await expect.element(screen.getByText(`Chunk ${i}`)).toBeVisible();
      }
    });

    it("Select all works correctly with many chunks", async () => {
      const manyChunks = Array.from({ length: 5 }, (_, i) => ({
        chunkId: 100 + i,
        sequenceOrder: i + 1,
        topics: [`topic-${i}-a`, `topic-${i}-b`, `topic-${i}-c`],
      }));
      mockDesktopGlobals(createSuccessInvoke(manyChunks));
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      await userEvent.click(selectAllButton(screen));
      await expect.element(screen.getByText("15 topics selected")).toBeVisible();
    });
  });

  describe("chunk checkbox aria-label", () => {
    it("has an accessible label for each chunk checkbox", async () => {
      mockDesktopGlobals(createSuccessInvoke());
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      expect(
        screen.getByRole("checkbox", { name: "Select all topics in chunk 1" }).query(),
      ).not.toBeNull();
      expect(
        screen.getByRole("checkbox", { name: "Select all topics in chunk 2" }).query(),
      ).not.toBeNull();
    });
  });

  describe("keyboard shortcut on topics step", () => {
    it("does not trigger extraction when on topics step", async () => {
      const invoke = createSuccessInvoke();
      mockDesktopGlobals(invoke);
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      const callsBefore = invoke.mock.calls.length;

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          metaKey: true,
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(invoke.mock.calls.length).toBe(callsBefore);
      await expect.element(screen.getByText("Select topics")).toBeVisible();
    });
  });

  describe("zero-topics chunk", () => {
    it("hides empty chunks and only renders chunks with topics", async () => {
      const chunks = [
        { chunkId: 101, sequenceOrder: 1, topics: [] as string[] },
        { chunkId: 102, sequenceOrder: 2, topics: ["membranes"] },
      ];
      mockDesktopGlobals(createSuccessInvoke(chunks));
      const screen = await renderForgePage();
      await navigateToTopics(screen);

      await expect.element(screen.getByText("Chunk 2")).toBeVisible();
      await expect.element(screen.getByText("membranes")).toBeVisible();
      expect(screen.getByText("Chunk 1").query()).toBeNull();
    });
  });
});
