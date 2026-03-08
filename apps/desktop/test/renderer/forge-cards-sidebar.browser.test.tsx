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
  readonly family: "detail" | "synthesis";
  readonly chunkId: number | null;
  readonly sequenceOrder: number | null;
  readonly topicIndex: number;
  readonly topicText: string;
  readonly topicId: number;
};

const DETAIL_TOPICS: ReadonlyArray<TopicDef> = [
  {
    family: "detail",
    chunkId: 101,
    sequenceOrder: 0,
    topicIndex: 0,
    topicText: "alpha",
    topicId: 1001,
  },
  {
    family: "detail",
    chunkId: 101,
    sequenceOrder: 0,
    topicIndex: 1,
    topicText: "beta",
    topicId: 1002,
  },
  {
    family: "detail",
    chunkId: 102,
    sequenceOrder: 1,
    topicIndex: 0,
    topicText: "gamma",
    topicId: 1003,
  },
  {
    family: "detail",
    chunkId: 102,
    sequenceOrder: 1,
    topicIndex: 1,
    topicText: "delta",
    topicId: 1004,
  },
];

const SYNTHESIS_TOPICS: ReadonlyArray<TopicDef> = [
  {
    family: "synthesis",
    chunkId: null,
    sequenceOrder: null,
    topicIndex: 0,
    topicText: "cross-cutting theme",
    topicId: 2001,
  },
];

const typedFailure = <T extends { readonly _tag: string }>(data: T) => ({
  type: "failure" as const,
  error: {
    tag: data._tag,
    data,
  },
});

const createCardsInvoke = (allTopics: ReadonlyArray<TopicDef> = DETAIL_TOPICS) => {
  const sessionId = 77;
  const workspaceRootPath = FORGE_WORKSPACE_ROOT_PATH;
  const toSummary = (topic: TopicDef) => ({
    topicId: topic.topicId,
    sessionId,
    family: topic.family,
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
  const detailTopics = allTopics.filter((t) => t.family === "detail");
  const synthesisTopics = allTopics.filter((t) => t.family === "synthesis");
  const topicGroups = [
    ...Array.from(new Set(detailTopics.map((t) => t.chunkId))).map((chunkId, i) => ({
      groupId: `chunk:${chunkId}`,
      groupKind: "chunk" as const,
      family: "detail" as const,
      title: `Chunk ${i + 1}`,
      displayOrder: i,
      chunkId,
      topics: detailTopics
        .filter((t) => t.chunkId === chunkId)
        .map((topic) => ({
          topicId: topic.topicId,
          sessionId,
          family: "detail" as const,
          chunkId: topic.chunkId,
          chunkSequenceOrder: topic.sequenceOrder,
          topicIndex: topic.topicIndex,
          topicText: topic.topicText,
          selected: false,
        })),
    })),
    ...(synthesisTopics.length > 0
      ? [
          {
            groupId: "section:synthesis",
            groupKind: "section" as const,
            family: "synthesis" as const,
            title: "Synthesis",
            displayOrder: 100,
            chunkId: null,
            topics: synthesisTopics.map((topic) => ({
              topicId: topic.topicId,
              sessionId,
              family: "synthesis" as const,
              chunkId: null,
              chunkSequenceOrder: null,
              topicIndex: topic.topicIndex,
              topicText: topic.topicText,
              selected: false,
            })),
          },
        ]
      : []),
  ];
  const outcomes = [
    { family: "detail" as const, status: "extracted" as const, errorMessage: null },
    ...(synthesisTopics.length > 0
      ? [{ family: "synthesis" as const, status: "extracted" as const, errorMessage: null }]
      : []),
  ];
  const findTopic = (topicId: number) =>
    allTopics.find((topic) => topic.topicId === topicId) ?? null;

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
          outcomes,
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
          outcomes,
          groups: topicGroups,
        },
      };
    }
    if (method === "ForgeGetCardsSnapshot") {
      return {
        type: "success",
        data: {
          topics: allTopics.map(toSummary),
        },
      };
    }
    if (method === "ForgeGetTopicCards") {
      const input = payload as { topicId: number };
      const topic = findTopic(input.topicId);
      if (!topic) {
        return typedFailure({
          _tag: "topic_not_found",
          sessionId,
          topicId: input.topicId,
        });
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
        return typedFailure({
          _tag: "topic_not_found",
          sessionId,
          topicId: input.topicId,
        });
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

const navigateToCards = async (
  screen: Awaited<ReturnType<typeof renderWithIpcProviders>>,
  expectedTopicCount = 4,
) => {
  await uploadPdf();
  await userEvent.click(screen.getByText("Begin Extraction"));
  await expect.element(screen.getByText("Select topics")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Select all", exact: true }));
  await expect.element(screen.getByText(`${expectedTopicCount} topics selected`)).toBeVisible();
  await userEvent.click(screen.getByText("Continue to cards"));
  await expect
    .element(screen.getByRole("complementary").getByText("alpha", { exact: true }))
    .toBeVisible();
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
          ) as [string, { sessionId: number; topicIds: Array<number> }] | undefined,
      )
      .toBeTruthy();

    const generateCall = invoke.mock.calls.find(
      ([method]: unknown[]) => method === "ForgeGenerateSelectedTopicCards",
    ) as [string, { sessionId: number; topicIds: Array<number> }] | undefined;
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

  it("shows Details and Synthesis section headers when both families are present", async () => {
    const invoke = createCardsInvoke([...DETAIL_TOPICS, ...SYNTHESIS_TOPICS]);
    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen, 5);

    await expect.element(screen.getByText("Details", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Synthesis", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("cross-cutting theme", { exact: true })).toBeVisible();
  });

  it("omits section headers when only detail topics are present", async () => {
    const invoke = createCardsInvoke();
    mockDesktopGlobals(invoke);
    const screen = await renderWithIpcProviders(<ForgePage />);
    await navigateToCards(screen);

    expect(screen.getByText("Details", { exact: true }).query()).toBeNull();
    expect(screen.getByText("Synthesis", { exact: true }).query()).toBeNull();
  });
});
