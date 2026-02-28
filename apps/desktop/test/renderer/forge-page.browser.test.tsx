import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";

import { ForgePage } from "@/components/forge/forge-page";
import { renderWithIpcProviders } from "./render-with-providers";
import { mockDesktopGlobals, uploadPdf } from "./forge-test-helpers";

const renderForgePage = async () => renderWithIpcProviders(<ForgePage />);

const createSuccessInvoke = () =>
  vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
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

    if (method === "ForgeStartTopicExtraction") {
      const sourceFilePath = (payload as { sourceFilePath: string }).sourceFilePath;
      return {
        type: "success",
        data: {
          session: {
            id: 12,
            sourceKind: "pdf",
            sourceFilePath,
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

describe("ForgePage", () => {
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

    const onChunkExtracted = eventHandlers.get("ForgeTopicChunkExtracted");
    expect(onChunkExtracted).toBeDefined();

    onChunkExtracted?.({
      sourceFilePath: "/forge/source.pdf",
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

    const onChunkExtracted = eventHandlers.get("ForgeTopicChunkExtracted");
    expect(onChunkExtracted).toBeDefined();

    onChunkExtracted?.({
      sourceFilePath: "/forge/source.pdf",
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
      sourceFilePath: "/forge/source.pdf",
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
            tag: "preview_pdf_extraction_error",
            data: {
              _tag: "preview_pdf_extraction_error",
              sourceFilePath: "/forge/source.pdf",
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
        const sourceFilePath = (payload as { sourceFilePath: string }).sourceFilePath;
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
