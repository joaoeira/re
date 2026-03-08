import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";

import { ForgePage } from "@/components/forge/forge-page";
import { renderWithIpcProviders } from "./render-with-providers";
import {
  DEFAULT_FORGE_DECKS,
  FORGE_WORKSPACE_ROOT_PATH,
  forgeSettingsSuccess,
  mockDesktopGlobals,
  uploadPdf,
} from "./forge-test-helpers";

type TopicDef = {
  readonly chunkId: number;
  readonly sequenceOrder: number;
  readonly topicIndex: number;
  readonly topicText: string;
  readonly topicId: number;
};

const TOPICS: ReadonlyArray<TopicDef> = [
  { chunkId: 101, sequenceOrder: 0, topicIndex: 0, topicText: "alpha", topicId: 1001 },
  { chunkId: 101, sequenceOrder: 0, topicIndex: 1, topicText: "beta", topicId: 1002 },
  { chunkId: 102, sequenceOrder: 1, topicIndex: 0, topicText: "gamma", topicId: 1003 },
  { chunkId: 102, sequenceOrder: 1, topicIndex: 1, topicText: "delta", topicId: 1004 },
];

const createCardsInvoke = () => {
  const sessionId = 77;
  const workspaceRootPath = FORGE_WORKSPACE_ROOT_PATH;
  const toSummary = (topic: TopicDef) => ({
    topicId: topic.topicId,
    sessionId,
    family: "detail" as const,
    chunkId: topic.chunkId,
    chunkSequenceOrder: topic.sequenceOrder,
    topicIndex: topic.topicIndex,
    topicText: topic.topicText,
    status: "generated" as const,
    errorMessage: null,
    cardCount: 2,
    addedCount: 0,
    generationRevision: 1,
    selected: true,
  });
  const topicGroups = [
    {
      groupId: "chunk:101",
      groupKind: "chunk" as const,
      family: "detail" as const,
      title: "Chunk 1",
      displayOrder: 0,
      chunkId: 101,
      topics: TOPICS.filter((topic) => topic.chunkId === 101).map((topic) => ({
        topicId: topic.topicId,
        sessionId,
        family: "detail" as const,
        chunkId: topic.chunkId,
        chunkSequenceOrder: topic.sequenceOrder,
        topicIndex: topic.topicIndex,
        topicText: topic.topicText,
        selected: false,
      })),
    },
    {
      groupId: "chunk:102",
      groupKind: "chunk" as const,
      family: "detail" as const,
      title: "Chunk 2",
      displayOrder: 1,
      chunkId: 102,
      topics: TOPICS.filter((topic) => topic.chunkId === 102).map((topic) => ({
        topicId: topic.topicId,
        sessionId,
        family: "detail" as const,
        chunkId: topic.chunkId,
        chunkSequenceOrder: topic.sequenceOrder,
        topicIndex: topic.topicIndex,
        topicText: topic.topicText,
        selected: false,
      })),
    },
  ] as const;
  const findTopic = (topicId: number) => TOPICS.find((topic) => topic.topicId === topicId) ?? null;

  return vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
    if (method === "GetSettings") {
      return forgeSettingsSuccess(workspaceRootPath);
    }
    if (method === "ScanDecks") {
      return {
        type: "success",
        data: {
          rootPath: workspaceRootPath,
          decks: DEFAULT_FORGE_DECKS.map((deck) => ({ ...deck })),
        },
      };
    }
    if (method === "CreateDeck") {
      const input = payload as { relativePath: string };
      return {
        type: "success",
        data: {
          absolutePath: `${workspaceRootPath}/${input.relativePath}`,
        },
      };
    }
    if (method === "ForgePreviewChunks") {
      return { type: "success", data: { textLength: 230, totalPages: 4, chunkCount: 2 } };
    }
    if (method === "ForgeStartTopicExtraction") {
      return {
        type: "success",
        data: {
          session: {
            id: sessionId,
            sourceKind: "pdf",
            sourceLabel: "source.pdf",
            sourceFilePath: "/forge/source.pdf",
            deckPath: null,
            sourceFingerprint: "fp",
            status: "topics_extracted",
            errorMessage: null,
            createdAt: "2026-02-27T00:00:00.000Z",
            updatedAt: "2026-02-27T00:00:00.000Z",
          },
          duplicateOfSessionId: null,
          extraction: {
            sessionId,
            textLength: 230,
            preview: "preview",
            totalPages: 4,
            chunkCount: 2,
          },
          outcomes: [{ family: "detail", status: "extracted", errorMessage: null }],
          groups: topicGroups,
        },
      };
    }
    if (method === "ForgeGetTopicExtractionSnapshot") {
      return {
        type: "success",
        data: {
          session: {
            id: sessionId,
            sourceKind: "pdf",
            sourceLabel: "source.pdf",
            sourceFilePath: "/forge/source.pdf",
            deckPath: null,
            sourceFingerprint: "fp",
            status: "topics_extracted",
            errorMessage: null,
            createdAt: "2026-02-27T00:00:00.000Z",
            updatedAt: "2026-02-27T00:00:00.000Z",
          },
          outcomes: [{ family: "detail", status: "extracted", errorMessage: null }],
          groups: topicGroups,
        },
      };
    }
    if (method === "ForgeGetCardsSnapshot") {
      return {
        type: "success",
        data: {
          topics: TOPICS.map(toSummary),
        },
      };
    }
    if (method === "ForgeGetTopicCards") {
      const input = payload as { topicId: number };
      const topic = findTopic(input.topicId);
      if (!topic) {
        return {
          type: "failure",
          error: {
            _tag: "topic_not_found",
            sessionId,
            topicId: input.topicId,
          },
        };
      }
      return {
        type: "success",
        data: {
          topic: toSummary(topic),
          cards: [
            { id: 9001, question: "Q1", answer: "A1", addedToDeck: false },
            { id: 9002, question: "Q2", answer: "A2", addedToDeck: false },
          ],
        },
      };
    }
    if (method === "ForgeSaveTopicSelections") {
      return { type: "success", data: {} };
    }
    if (method === "ForgeGenerateTopicCards") {
      const input = payload as { topicId: number };
      const topic = findTopic(input.topicId);
      if (!topic) {
        return {
          type: "failure",
          error: {
            _tag: "topic_not_found",
            sessionId,
            topicId: input.topicId,
          },
        };
      }
      return {
        type: "success",
        data: {
          topic: toSummary(topic),
          cards: [
            { id: 9001, question: "Q1", answer: "A1", addedToDeck: false },
            { id: 9002, question: "Q2", answer: "A2", addedToDeck: false },
          ],
        },
      };
    }
    if (method === "ForgeGenerateSelectedTopicCards") {
      const input = payload as {
        sessionId: number;
        topicIds: Array<number>;
      };
      return {
        type: "success",
        data: {
          sessionId: input.sessionId,
          results: input.topicIds.map((topicId) => ({
            topicId,
            status: "generated",
            message: null,
          })),
        },
      };
    }
    if (method === "ForgeListSessions") {
      return { type: "success", data: { sessions: [] } };
    }
    if (method === "ForgeSetSessionDeckPath") {
      return { type: "success", data: {} };
    }
    return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
  });
};

const navigateToCards = async (screen: Awaited<ReturnType<typeof renderWithIpcProviders>>) => {
  await uploadPdf();
  await userEvent.click(screen.getByText("Begin Extraction"));
  await expect.element(screen.getByText("Select topics")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Select all", exact: true }));
  await expect.element(screen.getByText("4 topics selected")).toBeVisible();
  await userEvent.click(screen.getByText("Continue to cards"));
  await expect.element(screen.getByText("Topics · 4")).toBeVisible();
};

const findSidebarRow = (
  screen: Awaited<ReturnType<typeof renderWithIpcProviders>>,
  text: string,
) => {
  const el = screen.getByText(text, { exact: true }).element().closest("button");
  if (!(el instanceof HTMLElement)) throw new Error(`Sidebar row for "${text}" not found`);
  return el;
};

describe("Forge cards sidebar multi-select", () => {
  it("does not show batch action bar by default", async () => {
    const invoke = createCardsInvoke();
    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    expect(screen.getByText("selected", { exact: false }).query()).toBeNull();
  });

  it("shows batch action bar when a topic checkbox is clicked", async () => {
    const invoke = createCardsInvoke();
    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    const betaRow = findSidebarRow(screen, "beta");
    const checkboxArea =
      betaRow.querySelector("[data-slot='checkbox-indicator']")?.closest("div[class]") ??
      betaRow.children[0];
    (checkboxArea as HTMLElement).click();

    await expect.element(screen.getByText("1 selected")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Generate cards" })).toBeVisible();
  });

  it("increments count when checking multiple topics", async () => {
    const invoke = createCardsInvoke();
    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    const betaRow = findSidebarRow(screen, "beta");
    (betaRow.children[0] as HTMLElement).click();
    await expect.element(screen.getByText("1 selected")).toBeVisible();

    const gammaRow = findSidebarRow(screen, "gamma");
    (gammaRow.children[0] as HTMLElement).click();
    await expect.element(screen.getByText("2 selected")).toBeVisible();
  });

  it("unchecks a topic when clicking its checkbox again", async () => {
    const invoke = createCardsInvoke();
    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    const betaRow = findSidebarRow(screen, "beta");
    (betaRow.children[0] as HTMLElement).click();
    await expect.element(screen.getByText("1 selected")).toBeVisible();

    findSidebarRow(screen, "beta").children[0]!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await expect.poll(() => screen.getByText("selected", { exact: false }).query()).toBeNull();
  });

  it("clears selection when Escape is pressed", async () => {
    const invoke = createCardsInvoke();
    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    const betaRow = findSidebarRow(screen, "beta");
    (betaRow.children[0] as HTMLElement).click();
    await expect.element(screen.getByText("1 selected")).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => screen.getByText("selected", { exact: false }).query()).toBeNull();
  });

  it("clears selection when Esc button is clicked", async () => {
    const invoke = createCardsInvoke();
    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    const betaRow = findSidebarRow(screen, "beta");
    (betaRow.children[0] as HTMLElement).click();
    await expect.element(screen.getByText("1 selected")).toBeVisible();

    const escButton = screen.getByText("Esc").element().closest("button");
    if (!(escButton instanceof HTMLElement)) throw new Error("Esc button not found");
    escButton.click();

    await expect.poll(() => screen.getByText("selected", { exact: false }).query()).toBeNull();
  });

  it("clears selection when Generate cards button is clicked", async () => {
    const invoke = createCardsInvoke();
    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    const betaRow = findSidebarRow(screen, "beta");
    (betaRow.children[0] as HTMLElement).click();
    await expect.element(screen.getByText("1 selected")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Generate cards" }));
    await expect.poll(() => screen.getByText("selected", { exact: false }).query()).toBeNull();

    await expect
      .poll(
        () =>
          invoke.mock.calls.find(
            ([method]: unknown[]) => method === "ForgeGenerateSelectedTopicCards",
          ) as
            | [string, { sessionId: number; topicIds: Array<number> }]
            | undefined,
      )
      .toBeTruthy();

    const generateCall = invoke.mock.calls.find(
      ([method]: unknown[]) => method === "ForgeGenerateSelectedTopicCards",
    ) as
      | [string, { sessionId: number; topicIds: Array<number> }]
      | undefined;
    expect(generateCall?.[1]).toEqual({
      sessionId: 77,
      topicIds: [1002],
      concurrencyLimit: 3,
    });
  });

  it("clicking a topic row navigates without entering selection mode", async () => {
    const invoke = createCardsInvoke();
    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    const gammaRow = findSidebarRow(screen, "gamma");
    gammaRow.click();

    expect(screen.getByText("selected", { exact: false }).query()).toBeNull();
  });
});
