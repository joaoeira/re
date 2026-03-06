import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";

import { ForgePage } from "@/components/forge/forge-page";
import { createForgeInvoke, createForgeStartTopicExtractionSuccess } from "./forge-ipc-mocks";
import { renderWithIpcProviders } from "./render-with-providers";
import { mockDesktopGlobals, uploadPdf, waitForFileInput } from "./forge-test-helpers";

const renderForgePage = async (
  props: {
    readonly initialSessionId?: number | null;
    readonly onSessionChange?: (session: { id: number; sourceLabel: string } | null) => void;
  } = {},
) => renderWithIpcProviders(<ForgePage {...props} />);

const openTextEditor = async (screen: Awaited<ReturnType<typeof renderForgePage>>) => {
  await userEvent.click(screen.getByText("Drop a PDF, or click to paste text"));
  await expect.element(screen.getByRole("textbox", { name: "Paste source text" })).toBeVisible();
};

const createSuccessInvoke = () =>
  createForgeInvoke({
    handlers: {
      ForgeStartTopicExtraction: (payload) =>
        createForgeStartTopicExtractionSuccess({
          source: (
            payload as
              | {
                  source:
                    | { kind: "pdf"; sourceFilePath: string }
                    | { kind: "text"; text: string; sourceLabel: string };
                }
              | undefined
          )?.source,
        }),
    },
  });

describe("ForgePage", () => {
  it("opens the dedicated text editor from the source canvas", async () => {
    const invoke = createSuccessInvoke();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await openTextEditor(screen);

    await expect.element(screen.getByRole("textbox", { name: "Paste source text" })).toBeVisible();
  });

  it("does not open the text editor when Browse PDF is clicked", async () => {
    const invoke = createSuccessInvoke();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await userEvent.click(screen.getByText("Browse PDF"));

    await waitForFileInput();
    expect(screen.getByRole("textbox", { name: "Paste source text" }).query()).toBeNull();
  });

  it("closes an empty text editor with Escape", async () => {
    const invoke = createSuccessInvoke();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await openTextEditor(screen);

    await userEvent.keyboard("{Escape}");

    await expect.element(screen.getByText("Drop a PDF, or click to paste text")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Paste source text" }).query()).toBeNull();
  });

  it("prompts before discarding a dirty text draft", async () => {
    const invoke = createSuccessInvoke();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await openTextEditor(screen);

    const textarea = screen.getByRole("textbox", { name: "Paste source text" });
    await userEvent.fill(textarea, "alpha beta gamma");

    await userEvent.click(screen.getByText("Back"));
    await expect.element(screen.getByText("Discard pasted text?")).toBeVisible();

    (screen.getByRole("button", { name: "Discard" }).element() as HTMLElement).click();
    await expect.element(screen.getByText("Drop a PDF, or click to paste text")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Paste source text" }).query()).toBeNull();
  });

  it("submits pasted text via ForgeStartTopicExtraction without previewing first", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [] } };
      }

      if (method === "ForgeStartTopicExtraction") {
        expect(payload).toEqual({
          source: {
            kind: "text",
            text: "alpha beta gamma",
          },
        });

        return {
          type: "success",
          data: {
            session: {
              id: 12,
              sourceKind: "text",
              sourceLabel: "Pasted text",
              sourceFilePath: null,
              deckPath: null,
              sourceFingerprint: "fp:text",
              status: "topics_extracted",
              errorMessage: null,
              createdAt: "2025-01-10T00:00:00.000Z",
              updatedAt: "2025-01-10T00:00:00.000Z",
            },
            duplicateOfSessionId: null,
            extraction: {
              sessionId: 12,
              textLength: 17,
              preview: "alpha beta gamma",
              totalPages: 1,
              chunkCount: 1,
            },
            topicsByChunk: [
              {
                chunkId: 101,
                sequenceOrder: 0,
                topics: ["alpha topic"],
              },
            ],
          },
        };
      }

      if (method === "ForgeGetTopicExtractionSnapshot") {
        return {
          type: "success",
          data: {
            session: null,
            topicsByChunk: [],
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await openTextEditor(screen);
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Paste source text" }),
      "alpha beta gamma",
    );
    await userEvent.click(screen.getByText("Extract topics"));

    await expect.element(screen.getByText("Select topics")).toBeVisible();
    await expect.element(screen.getByText("alpha topic")).toBeVisible();

    const previewCalls = invoke.mock.calls.filter(
      ([method]: unknown[]) => method === "ForgePreviewChunks",
    );
    expect(previewCalls).toHaveLength(0);
  });

  it("refetches the session list after a successful text extraction", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [] } };
      }

      if (method === "ForgeStartTopicExtraction") {
        return {
          type: "success",
          data: {
            session: {
              id: 22,
              sourceKind: "text",
              sourceLabel: "Pasted text",
              sourceFilePath: null,
              deckPath: null,
              sourceFingerprint: "fp:text",
              status: "topics_extracted",
              errorMessage: null,
              createdAt: "2025-01-10T00:00:00.000Z",
              updatedAt: "2025-01-10T00:00:00.000Z",
            },
            duplicateOfSessionId: null,
            extraction: {
              sessionId: 22,
              textLength: 17,
              preview: "alpha beta gamma",
              totalPages: 1,
              chunkCount: 1,
            },
            topicsByChunk: [
              {
                chunkId: 101,
                sequenceOrder: 0,
                topics: ["alpha topic"],
              },
            ],
          },
        };
      }

      if (method === "ForgeGetTopicExtractionSnapshot") {
        return {
          type: "success",
          data: {
            session: null,
            topicsByChunk: [],
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await openTextEditor(screen);
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Paste source text" }),
      "alpha beta gamma",
    );
    await userEvent.click(screen.getByText("Extract topics"));

    await expect
      .poll(
        () =>
          invoke.mock.calls.filter(([method]: unknown[]) => method === "ForgeListSessions").length,
      )
      .toBe(2);
  });

  it("does not update the active route session during a newly started text extraction", async () => {
    const onSessionChange = vi.fn();
    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [] } };
      }

      if (method === "ForgeStartTopicExtraction") {
        return {
          type: "success",
          data: {
            session: {
              id: 33,
              sourceKind: "text",
              sourceLabel: "Pasted text",
              sourceFilePath: null,
              deckPath: null,
              sourceFingerprint: "fp:text",
              status: "topics_extracted",
              errorMessage: null,
              createdAt: "2025-01-10T00:00:00.000Z",
              updatedAt: "2025-01-10T00:00:00.000Z",
            },
            duplicateOfSessionId: null,
            extraction: {
              sessionId: 33,
              textLength: 17,
              preview: "alpha beta gamma",
              totalPages: 1,
              chunkCount: 1,
            },
            topicsByChunk: [
              {
                chunkId: 101,
                sequenceOrder: 0,
                topics: ["alpha topic"],
              },
            ],
          },
        };
      }

      if (method === "ForgeGetTopicExtractionSnapshot") {
        return {
          type: "success",
          data: {
            session: null,
            topicsByChunk: [],
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke);

    const screen = await renderForgePage({ onSessionChange });
    await openTextEditor(screen);
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Paste source text" }),
      "alpha beta gamma",
    );
    await userEvent.click(screen.getByText("Extract topics"));

    await expect.element(screen.getByText("Select topics")).toBeVisible();
    expect(onSessionChange).not.toHaveBeenCalled();
  });

  it("does not update the active route session when extraction session creation is streamed", async () => {
    const onSessionChange = vi.fn();
    const eventHandlers = new Map<string, (payload: unknown) => void>();
    const subscribe = vi
      .fn()
      .mockImplementation((name: string, handler: (payload: unknown) => void) => {
        eventHandlers.set(name, handler);
        return () => {
          eventHandlers.delete(name);
        };
      });

    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [] } };
      }

      if (method === "ForgeStartTopicExtraction") {
        return await new Promise(() => {
          // keep extraction pending so the event path is the only signal
        });
      }

      if (method === "ForgeGetTopicExtractionSnapshot") {
        return {
          type: "success",
          data: {
            session: {
              id: 44,
              sourceKind: "text",
              sourceLabel: "Pasted text",
              sourceFilePath: null,
              deckPath: null,
              sourceFingerprint: "fp:text",
              status: "topics_extracting",
              errorMessage: null,
              createdAt: "2025-01-10T00:00:00.000Z",
              updatedAt: "2025-01-10T00:00:00.000Z",
            },
            topicsByChunk: [],
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke, undefined, subscribe);

    const screen = await renderForgePage({ onSessionChange });
    await openTextEditor(screen);
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Paste source text" }),
      "alpha beta gamma",
    );
    await userEvent.click(screen.getByText("Extract topics"));

    await expect.element(screen.getByText("Select topics")).toBeVisible();

    const onSessionCreated = eventHandlers.get("ForgeExtractionSessionCreated");
    expect(onSessionCreated).toBeDefined();
    onSessionCreated?.({ sessionId: 44 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onSessionChange).not.toHaveBeenCalled();
  });

  it("ignores a late extraction failure after snapshot polling has already completed the session", async () => {
    const eventHandlers = new Map<string, (payload: unknown) => void>();
    const subscribe = vi
      .fn()
      .mockImplementation((name: string, handler: (payload: unknown) => void) => {
        eventHandlers.set(name, handler);
        return () => {
          eventHandlers.delete(name);
        };
      });

    let resolveStartExtraction:
      | ((value: {
          type: "failure";
          error: {
            tag: "session_operation_error";
            data: {
              _tag: "session_operation_error";
              sessionId: number;
              message: string;
            };
          };
        }) => void)
      | undefined;

    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [] } };
      }

      if (method === "ForgeStartTopicExtraction") {
        return await new Promise((resolve) => {
          resolveStartExtraction = resolve as typeof resolveStartExtraction;
        });
      }

      if (method === "ForgeGetTopicExtractionSnapshot") {
        return {
          type: "success",
          data: {
            session: {
              id: 46,
              sourceKind: "text",
              sourceLabel: "Pasted text",
              sourceFilePath: null,
              deckPath: null,
              sourceFingerprint: "fp:text",
              status: "topics_extracted",
              errorMessage: null,
              createdAt: "2025-01-10T00:00:00.000Z",
              updatedAt: "2025-01-10T00:00:00.000Z",
            },
            topicsByChunk: [
              {
                chunkId: 101,
                sequenceOrder: 0,
                topics: ["alpha topic"],
              },
            ],
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke, undefined, subscribe);

    const screen = await renderForgePage();
    await openTextEditor(screen);
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Paste source text" }),
      "alpha beta gamma",
    );
    await userEvent.click(screen.getByText("Extract topics"));
    await expect.element(screen.getByText("Select topics")).toBeVisible();

    const onSessionCreated = eventHandlers.get("ForgeExtractionSessionCreated");
    expect(onSessionCreated).toBeDefined();
    onSessionCreated?.({ sessionId: 46 });

    await expect.element(screen.getByText("alpha topic")).toBeVisible();

    resolveStartExtraction?.({
      type: "failure",
      error: {
        tag: "session_operation_error",
        data: {
          _tag: "session_operation_error",
          sessionId: 46,
          message: "late failure",
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect.element(screen.getByText("Select topics")).toBeVisible();
    await expect.element(screen.getByText("alpha topic")).toBeVisible();
    expect(screen.getByText("Drop a PDF, or click to paste text").query()).toBeNull();
  });

  it("uses an indeterminate extracting state for text sources before chunk counts are known", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [] } };
      }

      if (method === "ForgeStartTopicExtraction") {
        return await new Promise(() => {
          // keep extraction pending
        });
      }

      if (method === "ForgeGetTopicExtractionSnapshot") {
        return {
          type: "success",
          data: {
            session: {
              id: 45,
              sourceKind: "text",
              sourceLabel: "Pasted text",
              sourceFilePath: null,
              deckPath: null,
              sourceFingerprint: "fp:text",
              status: "topics_extracting",
              errorMessage: null,
              createdAt: "2025-01-10T00:00:00.000Z",
              updatedAt: "2025-01-10T00:00:00.000Z",
            },
            topicsByChunk: [],
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await openTextEditor(screen);
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Paste source text" }),
      "alpha beta gamma",
    );
    await userEvent.click(screen.getByText("Extract topics"));

    await expect.element(screen.getByText("Extracting sections…")).toBeVisible();
    expect(
      screen.getByRole("progressbar", { name: "Topic extraction progress" }).query(),
    ).toBeNull();
  });

  it("returns to the text editor with the draft preserved when text extraction fails", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [] } };
      }

      if (method === "ForgeStartTopicExtraction") {
        return {
          type: "failure",
          error: {
            tag: "session_operation_error",
            data: {
              _tag: "session_operation_error",
              sessionId: 77,
              message: "Text extraction failed.",
            },
          },
        };
      }

      if (method === "ForgeGetTopicExtractionSnapshot") {
        return {
          type: "success",
          data: {
            session: null,
            topicsByChunk: [],
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await openTextEditor(screen);
    const textarea = screen.getByRole("textbox", { name: "Paste source text" });
    await userEvent.fill(textarea, "hello world");
    await userEvent.click(screen.getByText("Extract topics"));

    await expect.element(screen.getByText("Text extraction failed.")).toBeVisible();
    await expect.element(screen.getByRole("textbox", { name: "Paste source text" })).toBeVisible();
    await expect.element(textarea).toHaveValue("hello world");
  });

  it("shows an optional title input in the text editor", async () => {
    const invoke = createSuccessInvoke();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await openTextEditor(screen);

    await expect.element(screen.getByRole("textbox", { name: "Source title" })).toBeVisible();
  });

  it("sends sourceLabel when a title is provided", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [] } };
      }

      if (method === "ForgeStartTopicExtraction") {
        expect(payload).toEqual({
          source: {
            kind: "text",
            text: "alpha beta gamma",
            sourceLabel: "My custom title",
          },
        });

        return {
          type: "success",
          data: {
            session: {
              id: 12,
              sourceKind: "text",
              sourceLabel: "My custom title",
              sourceFilePath: null,
              deckPath: null,
              sourceFingerprint: "fp:text",
              status: "topics_extracted",
              errorMessage: null,
              createdAt: "2025-01-10T00:00:00.000Z",
              updatedAt: "2025-01-10T00:00:00.000Z",
            },
            duplicateOfSessionId: null,
            extraction: {
              sessionId: 12,
              textLength: 17,
              preview: "alpha beta gamma",
              totalPages: 1,
              chunkCount: 1,
            },
            topicsByChunk: [
              {
                chunkId: 101,
                sequenceOrder: 0,
                topics: ["alpha topic"],
              },
            ],
          },
        };
      }

      if (method === "ForgeGetTopicExtractionSnapshot") {
        return {
          type: "success",
          data: {
            session: null,
            topicsByChunk: [],
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await openTextEditor(screen);
    await userEvent.fill(screen.getByRole("textbox", { name: "Source title" }), "My custom title");
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Paste source text" }),
      "alpha beta gamma",
    );
    await userEvent.click(screen.getByText("Extract topics"));

    await expect.element(screen.getByText("Select topics")).toBeVisible();
  });

  it("omits sourceLabel when the title field is left blank", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [] } };
      }

      if (method === "ForgeStartTopicExtraction") {
        const source = (payload as { source: Record<string, unknown> }).source;
        expect(source).not.toHaveProperty("sourceLabel");

        return {
          type: "success",
          data: {
            session: {
              id: 13,
              sourceKind: "text",
              sourceLabel: "alpha beta gamma",
              sourceFilePath: null,
              deckPath: null,
              sourceFingerprint: "fp:text2",
              status: "topics_extracted",
              errorMessage: null,
              createdAt: "2025-01-10T00:00:00.000Z",
              updatedAt: "2025-01-10T00:00:00.000Z",
            },
            duplicateOfSessionId: null,
            extraction: {
              sessionId: 13,
              textLength: 17,
              preview: "alpha beta gamma",
              totalPages: 1,
              chunkCount: 1,
            },
            topicsByChunk: [
              {
                chunkId: 101,
                sequenceOrder: 0,
                topics: ["alpha topic"],
              },
            ],
          },
        };
      }

      if (method === "ForgeGetTopicExtractionSnapshot") {
        return {
          type: "success",
          data: {
            session: null,
            topicsByChunk: [],
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await openTextEditor(screen);
    await userEvent.fill(
      screen.getByRole("textbox", { name: "Paste source text" }),
      "alpha beta gamma",
    );
    await userEvent.click(screen.getByText("Extract topics"));

    await expect.element(screen.getByText("Select topics")).toBeVisible();
  });

  it("preserves the title draft when text extraction fails", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [] } };
      }

      if (method === "ForgeStartTopicExtraction") {
        return {
          type: "failure",
          error: {
            tag: "session_operation_error",
            data: {
              _tag: "session_operation_error",
              sessionId: 78,
              message: "Title extraction failed.",
            },
          },
        };
      }

      if (method === "ForgeGetTopicExtractionSnapshot") {
        return {
          type: "success",
          data: {
            session: null,
            topicsByChunk: [],
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await openTextEditor(screen);
    await userEvent.fill(screen.getByRole("textbox", { name: "Source title" }), "My notes");
    await userEvent.fill(screen.getByRole("textbox", { name: "Paste source text" }), "hello world");
    await userEvent.click(screen.getByText("Extract topics"));

    await expect.element(screen.getByText("Title extraction failed.")).toBeVisible();
    await expect
      .element(screen.getByRole("textbox", { name: "Source title" }))
      .toHaveValue("My notes");
    await expect
      .element(screen.getByRole("textbox", { name: "Paste source text" }))
      .toHaveValue("hello world");
  });

  it("requests preview on upload and enables Begin Extraction", async () => {
    const invoke = createSuccessInvoke();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();

    expect(screen.getByText("Begin Extraction").query()).toBeNull();

    await uploadPdf();

    await expect
      .element(screen.getByText("Estimated 2 chunk(s) across 4 page(s) and 230 character(s)."))
      .toBeVisible();
    await expect.element(screen.getByText("Begin Extraction")).toBeVisible();
    await expect
      .element(screen.getByText("Begin Extraction").element().closest("button")!)
      .toBeEnabled();

    const previewCalls = invoke.mock.calls
      .map(([method]: unknown[]) => method)
      .filter((method) => method === "ForgePreviewChunks");
    expect(previewCalls).toEqual(["ForgePreviewChunks"]);
  });

  it("clears a previously selected PDF when an invalid file is dropped", async () => {
    const invoke = createSuccessInvoke();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await uploadPdf();
    await expect.element(screen.getByText("Begin Extraction")).toBeVisible();

    const dropZone = document.querySelector('[aria-label="Add forge source"]');
    if (!(dropZone instanceof HTMLElement)) throw new Error("Expected drop zone element.");

    const invalidFile = new File(["hello"], "notes.txt", { type: "text/plain" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(invalidFile);

    dropZone.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer }));

    await expect.element(screen.getByText("Only PDF files are supported right now.")).toBeVisible();
    expect(screen.getByText("Begin Extraction").query()).toBeNull();
  });

  it("runs one ForgeStartTopicExtraction call", async () => {
    const invoke = createSuccessInvoke();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await uploadPdf();
    await userEvent.click(screen.getByText("Begin Extraction"));

    await expect.element(screen.getByText("Select topics")).toBeVisible();

    const forgeCalls = invoke.mock.calls
      .map(([method]: unknown[]) => method)
      .filter(
        (method) =>
          method === "ForgeCreateSession" ||
          method === "ForgeExtractText" ||
          method === "ForgeStartTopicExtraction",
      );
    expect(forgeCalls).toEqual(["ForgeStartTopicExtraction"]);
  });

  it("moves to topics immediately and appends streamed chunk topics before completion", async () => {
    const eventHandlers = new Map<string, (payload: unknown) => void>();
    const subscribe = vi
      .fn()
      .mockImplementation((name: string, handler: (payload: unknown) => void) => {
        eventHandlers.set(name, handler);
        return () => {
          eventHandlers.delete(name);
        };
      });

    let resolveStartExtraction: ((value: { type: "success"; data: unknown }) => void) | undefined;

    const invoke = vi.fn().mockImplementation(async (method: string, _payload?: unknown) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [] } };
      }

      if (method === "ForgePreviewChunks") {
        return {
          type: "success",
          data: {
            textLength: 230,
            totalPages: 4,
            chunkCount: 2,
          },
        };
      }

      if (method === "ForgeGetTopicExtractionSnapshot") {
        return {
          type: "success",
          data: {
            session: {
              id: 12,
              sourceKind: "pdf",
              sourceLabel: "source.pdf",
              sourceFilePath: "/forge/source.pdf",
              deckPath: null,
              sourceFingerprint: "fp:start",
              status: "topics_extracting",
              errorMessage: null,
              createdAt: "9999-01-10T00:00:00.000Z",
              updatedAt: "9999-01-10T00:00:00.000Z",
            },
            topicsByChunk: [],
          },
        };
      }

      if (method === "ForgeStartTopicExtraction") {
        return await new Promise((resolve) => {
          resolveStartExtraction = resolve as (value: { type: "success"; data: unknown }) => void;
        });
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke, (file) => `/forge/${file.name}`, subscribe);

    const screen = await renderForgePage();
    await uploadPdf();
    await userEvent.click(screen.getByText("Begin Extraction"));

    await expect.element(screen.getByText("Select topics")).toBeVisible();
    await expect.element(screen.getByText("Waiting for first chunk...")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const onSessionCreated = eventHandlers.get("ForgeExtractionSessionCreated");
    expect(onSessionCreated).toBeDefined();
    onSessionCreated?.({ sessionId: 12 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const onChunkExtracted = eventHandlers.get("ForgeTopicChunkExtracted");
    expect(onChunkExtracted).toBeDefined();

    onChunkExtracted?.({
      sessionId: 12,
      chunk: {
        chunkId: 101,
        sequenceOrder: 0,
        topics: ["biology", "cells"],
      },
    });

    await expect.element(screen.getByText("biology")).toBeVisible();
    await expect.element(screen.getByText("cells")).toBeVisible();

    resolveStartExtraction?.({
      type: "success",
      data: {
        session: {
          id: 12,
          sourceKind: "pdf",
          sourceLabel: "source.pdf",
          sourceFilePath: "/forge/source.pdf",
          deckPath: null,
          sourceFingerprint: "fp:start",
          status: "topics_extracted",
          errorMessage: null,
          createdAt: "2025-01-10T00:00:00.000Z",
          updatedAt: "2025-01-10T00:00:00.000Z",
        },
        duplicateOfSessionId: null,
        extraction: {
          sessionId: 12,
          textLength: 230,
          preview: "sample extracted preview",
          totalPages: 4,
          chunkCount: 2,
        },
        topicsByChunk: [
          {
            chunkId: 101,
            sequenceOrder: 0,
            topics: ["biology", "cells"],
          },
          {
            chunkId: 102,
            sequenceOrder: 1,
            topics: ["membranes"],
          },
        ],
      },
    });

    await expect.element(screen.getByText("membranes")).toBeVisible();
  });

  it("ignores chunk events from a different session for the same source file", async () => {
    const eventHandlers = new Map<string, (payload: unknown) => void>();
    const subscribe = vi
      .fn()
      .mockImplementation((name: string, handler: (payload: unknown) => void) => {
        eventHandlers.set(name, handler);
        return () => {
          eventHandlers.delete(name);
        };
      });

    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [] } };
      }

      if (method === "ForgePreviewChunks") {
        return {
          type: "success",
          data: {
            textLength: 230,
            totalPages: 4,
            chunkCount: 2,
          },
        };
      }

      if (method === "ForgeGetTopicExtractionSnapshot") {
        return {
          type: "success",
          data: {
            session: {
              id: 500,
              sourceKind: "pdf",
              sourceLabel: "source.pdf",
              sourceFilePath: "/forge/source.pdf",
              deckPath: null,
              sourceFingerprint: "fp:start",
              status: "topics_extracting",
              errorMessage: null,
              createdAt: "9999-01-10T00:00:00.000Z",
              updatedAt: "9999-01-10T00:00:00.000Z",
            },
            topicsByChunk: [],
          },
        };
      }

      if (method === "ForgeStartTopicExtraction") {
        return await new Promise(() => {
          // keep extracting state active for this test
        });
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke, (file) => `/forge/${file.name}`, subscribe);

    const screen = await renderForgePage();
    await uploadPdf();
    await userEvent.click(screen.getByText("Begin Extraction"));
    await expect.element(screen.getByText("Select topics")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const onSessionCreated = eventHandlers.get("ForgeExtractionSessionCreated");
    expect(onSessionCreated).toBeDefined();
    onSessionCreated?.({ sessionId: 500 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const onChunkExtracted = eventHandlers.get("ForgeTopicChunkExtracted");
    expect(onChunkExtracted).toBeDefined();

    onChunkExtracted?.({
      sessionId: 499,
      chunk: {
        chunkId: 101,
        sequenceOrder: 0,
        topics: ["stale-topic"],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("stale-topic").query()).toBeNull();

    onChunkExtracted?.({
      sessionId: 500,
      chunk: {
        chunkId: 102,
        sequenceOrder: 1,
        topics: ["fresh-topic"],
      },
    });
    await expect.element(screen.getByText("fresh-topic")).toBeVisible();
  });

  it("does not issue two start-extraction calls when Begin Extraction is double-clicked", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [] } };
      }

      if (method === "ForgePreviewChunks") {
        return {
          type: "success",
          data: { textLength: 230, totalPages: 4, chunkCount: 2 },
        };
      }

      if (method === "ForgeGetTopicExtractionSnapshot") {
        return {
          type: "success",
          data: {
            session: null,
            topicsByChunk: [],
          },
        };
      }

      if (method === "ForgeStartTopicExtraction") {
        return await new Promise(() => {
          // keep pending to simulate long-running extraction
        });
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke);
    const screen = await renderForgePage();
    await uploadPdf();

    const beginButton = screen.getByText("Begin Extraction").element().closest("button");
    if (!(beginButton instanceof HTMLButtonElement)) {
      throw new Error("Expected Begin Extraction button.");
    }
    await expect.element(beginButton).toBeEnabled();

    beginButton.click();
    beginButton.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const forgeCalls = invoke.mock.calls
      .map(([method]: unknown[]) => method)
      .filter((method) => method === "ForgeStartTopicExtraction");
    expect(forgeCalls).toEqual(["ForgeStartTopicExtraction"]);
  });

  it("runs ForgeStartTopicExtraction for Cmd+Enter", async () => {
    const invoke = createSuccessInvoke();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await uploadPdf();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        metaKey: true,
      }),
    );

    await expect.element(screen.getByText("Select topics")).toBeVisible();

    const forgeCalls = invoke.mock.calls
      .map(([method]: unknown[]) => method)
      .filter((method) => method === "ForgeStartTopicExtraction");
    expect(forgeCalls).toEqual(["ForgeStartTopicExtraction"]);
  });

  it("runs ForgeStartTopicExtraction for Ctrl+Enter", async () => {
    const invoke = createSuccessInvoke();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await uploadPdf();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        ctrlKey: true,
      }),
    );

    await expect.element(screen.getByText("Select topics")).toBeVisible();

    const forgeCalls = invoke.mock.calls
      .map(([method]: unknown[]) => method)
      .filter((method) => method === "ForgeStartTopicExtraction");
    expect(forgeCalls).toEqual(["ForgeStartTopicExtraction"]);
  });

  it("renders preview error inline", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [] } };
      }

      if (method === "ForgePreviewChunks") {
        return {
          type: "failure",
          error: {
            tag: "source_resolve_error",
            data: {
              _tag: "source_resolve_error",
              sourceKind: "pdf",
              sourceLabel: "source.pdf",
              message: "Preview failed",
            },
          },
        };
      }
      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke);
    const screen = await renderForgePage();
    await uploadPdf();

    await expect.element(screen.getByText("Preview failed")).toBeVisible();
    await expect
      .element(screen.getByText("Begin Extraction").element().closest("button")!)
      .toBeDisabled();
  });

  it("renders extraction error inline", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [] } };
      }

      if (method === "ForgePreviewChunks") {
        return {
          type: "success",
          data: { textLength: 230, totalPages: 4, chunkCount: 2 },
        };
      }
      if (method === "ForgeStartTopicExtraction") {
        return {
          type: "failure",
          error: {
            tag: "session_operation_error",
            data: {
              _tag: "session_operation_error",
              sessionId: 11,
              message: "Session write failed",
            },
          },
        };
      }
      if (method === "ForgeGetTopicExtractionSnapshot") {
        return {
          type: "success",
          data: {
            session: null,
            topicsByChunk: [],
          },
        };
      }
      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke);
    const screen = await renderForgePage();
    await uploadPdf();

    await expect.element(screen.getByText("Begin Extraction")).toBeVisible();
    await userEvent.click(screen.getByText("Begin Extraction"));
    await expect.element(screen.getByText("Session write failed")).toBeVisible();
  });

  it("ignores stale preview responses when files are reselected quickly", async () => {
    const pendingPreviews: Array<{
      readonly sourceFilePath: string;
      readonly resolve: (result: unknown) => void;
    }> = [];

    const invoke = vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
      if (method === "ForgeListSessions") {
        return { type: "success", data: { sessions: [] } };
      }

      if (method === "ForgePreviewChunks") {
        const sourceFilePath = (
          payload as {
            source: {
              kind: "pdf";
              sourceFilePath: string;
            };
          }
        ).source.sourceFilePath;
        return await new Promise((resolve) => {
          pendingPreviews.push({ sourceFilePath, resolve });
        });
      }

      if (method === "ForgeStartTopicExtraction") {
        return {
          type: "success",
          data: {
            session: {
              id: 99,
              sourceKind: "pdf",
              sourceLabel: "second.pdf",
              sourceFilePath: "/forge/second.pdf",
              deckPath: null,
              sourceFingerprint: "fp",
              status: "topics_extracted",
              errorMessage: null,
              createdAt: "2025-01-10T00:00:00.000Z",
              updatedAt: "2025-01-10T00:00:00.000Z",
            },
            duplicateOfSessionId: null,
            extraction: {
              sessionId: 99,
              textLength: 10,
              preview: "ok",
              totalPages: 1,
              chunkCount: 1,
            },
            topicsByChunk: [],
          },
        };
      }
      if (method === "ForgeGetTopicExtractionSnapshot") {
        return {
          type: "success",
          data: {
            session: null,
            topicsByChunk: [],
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await uploadPdf("first.pdf");
    await uploadPdf("second.pdf");

    await expect.poll(() => pendingPreviews.length).toBe(2);

    const first = pendingPreviews.find((entry) => entry.sourceFilePath.endsWith("/first.pdf"));
    const second = pendingPreviews.find((entry) => entry.sourceFilePath.endsWith("/second.pdf"));
    if (!first || !second) {
      throw new Error("Expected both preview requests.");
    }

    first.resolve({
      type: "success",
      data: {
        textLength: 10,
        totalPages: 1,
        chunkCount: 99,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      screen.getByText("Estimated 99 chunk(s) across 1 page(s) and 10 character(s).").query(),
    ).toBeNull();

    second.resolve({
      type: "success",
      data: {
        textLength: 20,
        totalPages: 1,
        chunkCount: 2,
      },
    });

    await expect
      .element(screen.getByText("Estimated 2 chunk(s) across 1 page(s) and 20 character(s)."))
      .toBeVisible();
  });
});
