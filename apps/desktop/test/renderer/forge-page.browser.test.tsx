import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";

import { ForgePage } from "@/components/forge/forge-page";
import { IpcProvider } from "@/lib/ipc-context";

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
  render(
    <IpcProvider>
      <ForgePage />
    </IpcProvider>,
  );

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
    if (method === "ForgeCreateSession") {
      const sourceFilePath = (payload as { sourceFilePath: string }).sourceFilePath;
      return {
        type: "success",
        data: {
          session: {
            id: 1,
            sourceKind: "pdf",
            sourceFilePath,
            deckPath: null,
            sourceFingerprint: "fp:source",
            status: "created",
            errorMessage: null,
            createdAt: "2025-01-10T00:00:00.000Z",
            updatedAt: "2025-01-10T00:00:00.000Z",
          },
          duplicateOfSessionId: null,
        },
      };
    }

    if (method === "ForgeExtractText") {
      const sessionId = (payload as { sessionId: number }).sessionId;
      return {
        type: "success",
        data: {
          sessionId,
          textLength: 23,
          preview: "sample extracted preview",
        },
      };
    }

    return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
  });

describe("ForgePage", () => {
  it("enables Begin Extraction after selecting a valid PDF", async () => {
    const invoke = createSuccessInvoke();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();

    expect(screen.getByText("Begin Extraction").query()).toBeNull();

    await uploadPdf();

    await expect.element(screen.getByText("Begin Extraction")).toBeVisible();
    await expect
      .element(screen.getByText("Begin Extraction").element().closest("button")!)
      .toBeEnabled();
  });

  it("runs ForgeCreateSession then ForgeExtractText via button click", async () => {
    const invoke = createSuccessInvoke();
    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();

    await uploadPdf();
    await userEvent.click(screen.getByText("Begin Extraction"));

    await expect.element(screen.getByText(/Extraction complete/)).toBeVisible();

    const forgeCalls = invoke.mock.calls
      .map(([method]: unknown[]) => method)
      .filter((method) => method === "ForgeCreateSession" || method === "ForgeExtractText");

    expect(forgeCalls).toEqual(["ForgeCreateSession", "ForgeExtractText"]);
  });

  it("runs the same RPC sequence for Cmd+Enter and Ctrl+Enter", async () => {
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

    await expect.element(screen.getByText(/Extraction complete/)).toBeVisible();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        ctrlKey: true,
      }),
    );

    await vi.waitFor(() => {
      const forgeCalls = invoke.mock.calls
        .map(([method]: unknown[]) => method)
        .filter((method) => method === "ForgeCreateSession" || method === "ForgeExtractText");

      expect(forgeCalls).toEqual([
        "ForgeCreateSession",
        "ForgeExtractText",
        "ForgeCreateSession",
        "ForgeExtractText",
      ]);
    });
  });

  it("renders success and error states from extraction outcomes", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
      if (method === "ForgeCreateSession") {
        const sourceFilePath = (payload as { sourceFilePath: string }).sourceFilePath;
        return {
          type: "success",
          data: {
            session: {
              id: 11,
              sourceKind: "pdf",
              sourceFilePath,
              deckPath: null,
              sourceFingerprint: "fp:source",
              status: "created",
              errorMessage: null,
              createdAt: "2025-01-10T00:00:00.000Z",
              updatedAt: "2025-01-10T00:00:00.000Z",
            },
            duplicateOfSessionId: 5,
          },
        };
      }

      if (method === "ForgeExtractText") {
        return {
          type: "failure",
          error: {
            tag: "forge_operation_error",
            data: {
              _tag: "forge_operation_error",
              message: "Extraction failed in test",
            },
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    mockDesktopGlobals(invoke);

    const screen = await renderForgePage();
    await uploadPdf();
    await userEvent.click(screen.getByText("Begin Extraction"));

    await expect.element(screen.getByText(/existing session id: 5/)).toBeVisible();
    await expect.element(screen.getByRole("alert")).toBeVisible();
    await expect.element(screen.getByText("Extraction failed in test")).toBeVisible();
  });
});
