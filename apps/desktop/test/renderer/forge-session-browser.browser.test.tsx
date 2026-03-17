import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";

import { ForgePage } from "@/components/forge/forge-page";
import { DEFAULT_SETTINGS } from "@shared/settings";
import { createForgeInvoke, createForgeTopicExtractionSnapshotSuccess } from "./forge-ipc-mocks";
import { renderWithIpcProviders } from "./render-with-providers";
import { mockDesktopGlobals, waitForFileInput } from "./forge-test-helpers";

const SESSION_A = {
  id: 1,
  sourceKind: "pdf" as const,
  sourceLabel: "biology.pdf",
  sourceFilePath: "/docs/biology.pdf",
  deckPath: null,
  status: "topics_extracted" as const,
  errorMessage: null,
  topicCount: 5,
  cardCount: 0,
  createdAt: "2026-02-27T10:00:00.000Z",
  updatedAt: "2026-02-27T10:30:00.000Z",
};

const SESSION_B = {
  id: 2,
  sourceKind: "pdf" as const,
  sourceLabel: "chemistry.pdf",
  sourceFilePath: "/docs/chemistry.pdf",
  deckPath: "/workspace/decks/beta.md",
  status: "ready" as const,
  errorMessage: null,
  topicCount: 3,
  cardCount: 12,
  createdAt: "2026-02-26T10:00:00.000Z",
  updatedAt: "2026-02-26T14:00:00.000Z",
};

const SESSION_C = {
  ...SESSION_B,
  id: 3,
  sourceLabel: "physics.pdf",
  sourceFilePath: "/docs/physics.pdf",
  deckPath: "/workspace/decks/missing.md",
};

const TEXT_SESSION = {
  ...SESSION_B,
  id: 4,
  sourceKind: "text" as const,
  sourceLabel: "Pasted text",
  sourceFilePath: null,
  status: "topics_extracting" as const,
  topicCount: 0,
  cardCount: 0,
};

const createInvokeWithSessions = (sessions: unknown[] = [SESSION_A, SESSION_B]) =>
  createForgeInvoke({
    sessions,
    previewData: {
      textLength: 100,
      totalPages: 2,
      chunkCount: 1,
    },
  });

const renderForgePage = async () => renderWithIpcProviders(<ForgePage />);

describe("ForgePage session browser", () => {
  it("shows session browser with sessions when sessions exist", async () => {
    const invoke = createInvokeWithSessions();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();

    await expect.element(screen.getByText("biology.pdf")).toBeVisible();
    await expect.element(screen.getByText("chemistry.pdf")).toBeVisible();
    await expect.element(screen.getByText("5 topics")).toBeVisible();
    await expect.element(screen.getByText("12 cards")).toBeVisible();
  });

  it("shows upload zone when no sessions exist", async () => {
    const invoke = createInvokeWithSessions([]);
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();

    await expect.element(screen.getByText("Drop a PDF, or click to paste text")).toBeVisible();
  });

  it("shows the new session upload bar in the session browser", async () => {
    const invoke = createInvokeWithSessions();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();

    await expect.element(screen.getByText("Browse PDF")).toBeVisible();
  });

  it("displays status labels for sessions", async () => {
    const invoke = createInvokeWithSessions();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();

    await expect.element(screen.getByText("Topics ready")).toBeVisible();
    await expect.element(screen.getByText("Reviewing cards")).toBeVisible();
  });

  it("resumes a session with topics into the topics step", async () => {
    const invoke = createInvokeWithSessions([SESSION_A]);
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await expect.element(screen.getByText("biology.pdf")).toBeVisible();

    await userEvent.click(screen.getByText("biology.pdf"));

    await expect.element(screen.getByText("Select topics")).toBeVisible();
  });

  it("resumes a session with cards by calling ForgeGetCardsSnapshot with the session id", async () => {
    const invoke = createInvokeWithSessions([SESSION_B]);
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await expect.element(screen.getByText("chemistry.pdf")).toBeVisible();

    await userEvent.click(screen.getByText("chemistry.pdf"));

    await expect
      .poll(() =>
        invoke.mock.calls.some(
          ([method, payload]: unknown[]) =>
            method === "ForgeGetCardsSnapshot" &&
            (payload as { sessionId: number })?.sessionId === SESSION_B.id,
        ),
      )
      .toBe(true);
  });

  it("hydrates persisted deck selection when resuming a cards session", async () => {
    const invoke = createInvokeWithSessions([SESSION_B]);
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await expect.element(screen.getByText("chemistry.pdf")).toBeVisible();

    await userEvent.click(screen.getByText("chemistry.pdf"));

    await expect
      .poll(() => {
        const trigger = document.querySelector("[data-slot='combobox-trigger']");
        if (!(trigger instanceof HTMLElement)) return "";
        return trigger.textContent?.replace(/\s+/g, " ").trim() ?? "";
      })
      .toContain("decks/beta.md");
  });

  it("clears a missing persisted deck on resume without silently selecting a fallback", async () => {
    const invoke = createInvokeWithSessions([SESSION_C]);
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await expect.element(screen.getByText("physics.pdf")).toBeVisible();

    await userEvent.click(screen.getByText("physics.pdf"));

    await expect
      .poll(() => {
        const trigger = document.querySelector("[data-slot='combobox-trigger']");
        if (!(trigger instanceof HTMLElement)) return "";
        return trigger.textContent?.replace(/\s+/g, " ").trim() ?? "";
      })
      .toContain("select deck");
    await expect
      .poll(() => {
        const trigger = document.querySelector("[data-slot='combobox-trigger']");
        if (!(trigger instanceof HTMLElement)) return true;
        return !trigger.textContent?.includes("decks/alpha.md");
      })
      .toBe(true);
    await expect
      .poll(() =>
        invoke.mock.calls.some(
          ([method, payload]: unknown[]) =>
            method === "ForgeSetSessionDeckPath" &&
            (payload as { sessionId: number; deckPath: string | null })?.sessionId ===
              SESSION_C.id &&
            (payload as { sessionId: number; deckPath: string | null })?.deckPath === null,
        ),
      )
      .toBe(true);
  });

  it("selects a file via the upload bar and transitions to source step", async () => {
    const invoke = createInvokeWithSessions();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await expect.element(screen.getByText("Browse PDF")).toBeVisible();

    const input = await waitForFileInput();

    const transfer = new DataTransfer();
    transfer.items.add(new File(["%PDF"], "new-source.pdf", { type: "application/pdf" }));
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await expect.element(screen.getByText("Selected: new-source.pdf")).toBeVisible();
  });

  it("filters out sessions with zero topics", async () => {
    const zeroTopicSession = {
      ...SESSION_A,
      id: 3,
      sourceFilePath: "/docs/empty.pdf",
      topicCount: 0,
    };
    const invoke = createInvokeWithSessions([zeroTopicSession]);
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();

    await expect.element(screen.getByText("Drop a PDF, or click to paste text")).toBeVisible();
    expect(screen.getByText("empty.pdf").query()).toBeNull();
  });

  it("shows drop error for non-PDF files", async () => {
    const invoke = createInvokeWithSessions();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await expect.element(screen.getByText("Browse PDF")).toBeVisible();

    const dropZone = document.querySelector('[aria-label="Add forge source"]');
    if (!(dropZone instanceof HTMLElement)) throw new Error("Expected drop zone element.");

    const notPdf = new File(["hello"], "notes.txt", { type: "text/plain" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(notPdf);

    dropZone.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer }));

    await expect.element(screen.getByText("Only PDF files are supported right now.")).toBeVisible();
  });

  it("shows in-progress text sessions even before any topics are persisted", async () => {
    const invoke = createInvokeWithSessions([TEXT_SESSION]);
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();

    await expect.element(screen.getByText("Pasted text")).toBeVisible();
    const sessionRow = screen.getByText("Pasted text").element().closest("button");
    if (!(sessionRow instanceof HTMLElement)) throw new Error("Expected session row element.");

    await expect.element(sessionRow).toHaveTextContent("Extracting topics");
  });

  it("resumes an extracting text session and enables continuing once snapshot polling reports completion", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [TEXT_SESSION] } };
      }
      if (method === "ForgeGetCardsSnapshot") {
        return {
          type: "success",
          data: {
            topics: [],
          },
        };
      }
      if (method === "ForgeGetTopicExtractionSnapshot") {
        return createForgeTopicExtractionSnapshotSuccess({
          source: { kind: "text", text: "alpha", sourceLabel: "Pasted text" },
          sessionId: TEXT_SESSION.id,
          status: "topics_extracted",
          topicsByChunk: [{ chunkId: 301, sequenceOrder: 0, topics: ["alpha"] }],
        });
      }
      if (method === "GetSettings") {
        return {
          type: "success",
          data: {
            ...DEFAULT_SETTINGS,
            workspace: { rootPath: "/workspace" },
          },
        };
      }
      if (method === "ScanDecks") {
        return {
          type: "success",
          data: {
            rootPath: "/workspace",
            decks: [],
          },
        };
      }
      if (method === "ForgeSetSessionDeckPath") {
        return { type: "success", data: {} };
      }
      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await userEvent.click(screen.getByText("Pasted text"));

    await expect.element(screen.getByText("Select topics")).toBeVisible();
    await expect.element(screen.getByText("alpha")).toBeVisible();
    await expect.element(screen.getByText("Extracted 1 topics from 1 chunks")).toBeVisible();

    await userEvent.click(screen.getByText("alpha"));
    await expect
      .element(screen.getByText("Continue to cards").element().closest("button")!)
      .toBeEnabled();

    expect(screen.getByText("Extracting sections…").query()).toBeNull();
  });

  it("shows error message when session resume fails", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [SESSION_A] } };
      }
      if (method === "ForgeGetCardsSnapshot") {
        return {
          type: "failure",
          error: {
            tag: "forge_operation_error",
            data: { _tag: "forge_operation_error", message: "Load failed" },
          },
        };
      }
      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await expect.element(screen.getByText("biology.pdf")).toBeVisible();

    await userEvent.click(screen.getByText("biology.pdf"));

    await expect
      .element(screen.getByText('Failed to load session data for "biology.pdf". Please try again.'))
      .toBeVisible();
    await expect.element(screen.getByText("biology.pdf", { exact: true })).toBeVisible();
  });

  it("ignores rapid double-clicks on a session (resumingRef guard)", async () => {
    let resolveSnapshot!: (value: unknown) => void;
    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [SESSION_B] } };
      }
      if (method === "ForgeGetCardsSnapshot") {
        return new Promise((resolve) => {
          resolveSnapshot = resolve;
        });
      }
      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await expect.element(screen.getByText("chemistry.pdf")).toBeVisible();

    const sessionButton = screen.getByText("chemistry.pdf").element() as HTMLElement;
    sessionButton.click();
    sessionButton.click();

    const snapshotCalls = invoke.mock.calls.filter(
      ([method]: unknown[]) => method === "ForgeGetCardsSnapshot",
    );
    expect(snapshotCalls.length).toBe(1);

    resolveSnapshot({
      type: "success",
      data: {
        topics: [
          {
            topicId: 10,
            sessionId: 2,
            family: "detail",
            chunkId: 100,
            chunkSequenceOrder: 0,
            topicIndex: 0,
            topicText: "Cell biology",
            status: "generated",
            errorMessage: null,
            cardCount: 5,
            addedCount: 0,
            generationRevision: 1,
            selected: true,
          },
        ],
      },
    });
    await new Promise((r) => setTimeout(r, 0));
  });
});
