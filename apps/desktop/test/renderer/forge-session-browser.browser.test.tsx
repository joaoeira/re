import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";

import { ForgePage } from "@/components/forge/forge-page";
import { renderWithIpcProviders } from "./render-with-providers";
import { mockDesktopGlobals, waitForFileInput } from "./forge-test-helpers";

const SESSION_A = {
  id: 1,
  sourceFilePath: "/docs/biology.pdf",
  status: "topics_extracted" as const,
  errorMessage: null,
  topicCount: 5,
  cardCount: 0,
  createdAt: "2026-02-27T10:00:00.000Z",
  updatedAt: "2026-02-27T10:30:00.000Z",
};

const SESSION_B = {
  id: 2,
  sourceFilePath: "/docs/chemistry.pdf",
  status: "ready" as const,
  errorMessage: null,
  topicCount: 3,
  cardCount: 12,
  createdAt: "2026-02-26T10:00:00.000Z",
  updatedAt: "2026-02-26T14:00:00.000Z",
};

const createInvokeWithSessions = (sessions: unknown[] = [SESSION_A, SESSION_B]) =>
  vi.fn().mockImplementation(async (method: string) => {
    if (method === "ForgeListSessions") {
      return { type: "success", data: { sessions } };
    }
    if (method === "ForgePreviewChunks") {
      return {
        type: "success",
        data: { textLength: 100, totalPages: 2, chunkCount: 1 },
      };
    }
    if (method === "ForgeGetTopicExtractionSnapshot") {
      return { type: "success", data: { session: null, topicsByChunk: [] } };
    }
    if (method === "ForgeGetCardsSnapshot") {
      return {
        type: "success",
        data: {
          topics: [
            {
              topicId: 10,
              chunkId: 100,
              sequenceOrder: 0,
              topicIndex: 0,
              topicText: "Cell biology",
              status: "generated",
              errorMessage: null,
              cardCount: 5,
              generationRevision: 1,
              selected: true,
            },
          ],
        },
      };
    }
    return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
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

    await expect.element(screen.getByText("Drop a PDF here, or")).toBeVisible();
  });

  it("shows the new session upload bar in the session browser", async () => {
    const invoke = createInvokeWithSessions();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();

    await expect.element(screen.getByText("browse files")).toBeVisible();
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

  it("selects a file via the upload bar and transitions to source step", async () => {
    const invoke = createInvokeWithSessions();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await expect.element(screen.getByText("browse files")).toBeVisible();

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

    await expect.element(screen.getByText("Drop a PDF here, or")).toBeVisible();
    expect(screen.getByText("empty.pdf").query()).toBeNull();
  });

  it("shows drop error for non-PDF files", async () => {
    const invoke = createInvokeWithSessions();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await expect.element(screen.getByText("browse files")).toBeVisible();

    const dropZone = screen.getByText("browse files").element().closest("[role='button']");
    if (!dropZone) throw new Error("Expected drop zone element.");

    const notPdf = new File(["hello"], "notes.txt", { type: "text/plain" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(notPdf);

    dropZone.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer }));

    await expect.element(screen.getByText("Only PDF files are supported.")).toBeVisible();
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
            chunkId: 100,
            sequenceOrder: 0,
            topicIndex: 0,
            topicText: "Cell biology",
            status: "generated",
            errorMessage: null,
            cardCount: 5,
            generationRevision: 1,
            selected: true,
          },
        ],
      },
    });
    await new Promise((r) => setTimeout(r, 0));
  });
});
