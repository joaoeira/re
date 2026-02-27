import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";

import { ForgePage } from "@/components/forge/forge-page";
import { renderWithIpcProviders } from "./render-with-providers";

const defaultOnStreamFrame: NonNullable<Window["desktopApi"]["onStreamFrame"]> = () => {
  return () => undefined;
};

const mockDesktopGlobals = (
  invoke: (...args: unknown[]) => Promise<unknown>,
  getPathForFile: (file: File) => string = (file) => `/forge/${file.name}`,
) => {
  Object.defineProperty(window, "desktopApi", {
    configurable: true,
    value: {
      invoke,
      subscribe: () => () => undefined,
      onStreamFrame: defaultOnStreamFrame,
    },
  });

  Object.defineProperty(window, "desktopHost", {
    configurable: true,
    value: {
      getPathForFile,
    },
  });
};

const renderForgePage = async () =>
  renderWithIpcProviders(<ForgePage />);

const uploadPdf = async (name = "source.pdf") => {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Expected Forge page file input.");
  }

  const transfer = new DataTransfer();
  transfer.items.add(new File(["%PDF"], name, { type: "application/pdf" }));
  Object.defineProperty(input, "files", {
    configurable: true,
    value: transfer.files,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

const createSuccessInvoke = () =>
  vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
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

  it("runs one ForgeStartTopicExtraction call and logs topics", async () => {
    const invoke = createSuccessInvoke();
    mockDesktopGlobals(invoke);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const screen = await renderForgePage();
    await uploadPdf();
    await userEvent.click(screen.getByText("Begin Extraction"));

    await expect.element(screen.getByText("Select topics")).toBeVisible();
    expect(consoleSpy).toHaveBeenCalledWith("[forge/topics]", [
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
    ]);

    const forgeCalls = invoke.mock.calls
      .map(([method]: unknown[]) => method)
      .filter(
        (method) =>
          method === "ForgeCreateSession" ||
          method === "ForgeExtractText" ||
          method === "ForgeStartTopicExtraction",
      );
    expect(forgeCalls).toEqual(["ForgeStartTopicExtraction"]);

    consoleSpy.mockRestore();
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
