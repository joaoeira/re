import { RouterProvider, createHashHistory, createRouter } from "@tanstack/react-router";
import { expect, it, describe, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { StoresProvider, createStores } from "@shared/state/stores-context";
import { routeTree } from "../../src/renderer/src/routeTree.gen";
import { renderWithIpcProviders } from "./render-with-providers";
import {
  DEFAULT_FORGE_DECKS,
  FORGE_WORKSPACE_ROOT_PATH,
  forgeSettingsSuccess,
  toDeckEntry,
} from "./forge-test-helpers";

const defaultOnStreamFrame: NonNullable<Window["desktopApi"]["onStreamFrame"]> = () => {
  return () => undefined;
};

const defaultSubscribe = vi.fn().mockReturnValue(() => undefined);

const mockDesktopApi = (
  invoke: (...args: unknown[]) => Promise<unknown>,
  subscribe: (...args: unknown[]) => () => void = defaultSubscribe,
) => {
  Object.defineProperty(window, "desktopApi", {
    configurable: true,
    value: { invoke, subscribe, onStreamFrame: defaultOnStreamFrame },
  });
};

const renderEditorApp = async (
  invoke: (...args: unknown[]) => Promise<unknown>,
  hashPath = "#/editor",
) => {
  mockDesktopApi(invoke);
  window.location.hash = hashPath;

  const stores = createStores();
  const router = createRouter({ routeTree, history: createHashHistory() });
  const screen = await renderWithIpcProviders(
    <StoresProvider stores={stores}>
      <RouterProvider router={router} />
    </StoresProvider>,
  );

  return { screen, router, stores };
};

const getDeckComboboxTrigger = (): HTMLButtonElement => {
  const trigger = document.querySelector("[data-slot='combobox-trigger']");
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new Error("Expected deck combobox trigger.");
  }
  return trigger;
};

const getDeckSelectionText = (): string => {
  return getDeckComboboxTrigger().textContent?.replace(/\s+/g, " ").trim() ?? "";
};

const openDeckCombobox = () => {
  getDeckComboboxTrigger().click();
};

const setDeckComboboxInputValue = async (value: string) => {
  await expect
    .poll(() => {
      return document.querySelector("[data-slot='combobox-input']") instanceof HTMLInputElement;
    })
    .toBe(true);

  const input = document.querySelector("[data-slot='combobox-input']");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Expected deck combobox input.");
  }
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await userEvent.type(input, value);
};

const findDeckOption = (relativePath: string) => {
  const options = Array.from(document.querySelectorAll("[data-slot='combobox-item']"));
  return options.find((option) => option.textContent?.includes(relativePath)) ?? null;
};

const selectDeckOption = async (relativePath: string) => {
  await expect.poll(() => Boolean(findDeckOption(relativePath))).toBe(true);
  const option = findDeckOption(relativePath);
  if (!(option instanceof HTMLElement)) {
    throw new Error(`Expected deck option for "${relativePath}".`);
  }
  option.click();
};

describe("EditorRoot", () => {
  it("creates a deck from the editor combobox and selects it", async () => {
    let decks = [...DEFAULT_FORGE_DECKS];
    const invoke = vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
      if (method === "GetSettings") {
        return forgeSettingsSuccess(FORGE_WORKSPACE_ROOT_PATH);
      }

      if (method === "ScanDecks") {
        return {
          type: "success",
          data: {
            rootPath: FORGE_WORKSPACE_ROOT_PATH,
            decks: decks.map((deck) => ({ ...deck })),
          },
        };
      }

      if (method === "CreateDeck") {
        const input = payload as { relativePath: string; createParents?: boolean };
        const createdDeck = toDeckEntry(FORGE_WORKSPACE_ROOT_PATH, input.relativePath);
        if (!decks.some((deck) => deck.absolutePath === createdDeck.absolutePath)) {
          decks = [...decks, createdDeck].sort((left, right) =>
            left.relativePath.localeCompare(right.relativePath),
          );
        }

        return {
          type: "success",
          data: {
            absolutePath: createdDeck.absolutePath,
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    await renderEditorApp(invoke);

    await expect
      .poll(() => {
        return (
          document.querySelector("[data-slot='combobox-trigger']") instanceof HTMLButtonElement
        );
      })
      .toBe(true);
    await expect.poll(() => getDeckSelectionText()).toContain("decks/alpha.md");

    openDeckCombobox();
    await setDeckComboboxInputValue("new-editor");
    await selectDeckOption("new-editor.md");

    await expect.poll(() => getDeckSelectionText()).toContain("new-editor.md");

    const createDeckCall = invoke.mock.calls.find(
      ([method]: unknown[]) => method === "CreateDeck",
    ) as [string, { relativePath: string; createParents?: boolean }] | undefined;
    expect(createDeckCall?.[1]).toEqual({
      relativePath: "new-editor.md",
      createParents: true,
    });
  });

  it("creates a nested deck from Enter in the editor combobox input", async () => {
    let decks = [...DEFAULT_FORGE_DECKS];
    const invoke = vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
      if (method === "GetSettings") {
        return forgeSettingsSuccess(FORGE_WORKSPACE_ROOT_PATH);
      }

      if (method === "ScanDecks") {
        return {
          type: "success",
          data: {
            rootPath: FORGE_WORKSPACE_ROOT_PATH,
            decks: decks.map((deck) => ({ ...deck })),
          },
        };
      }

      if (method === "CreateDeck") {
        const input = payload as { relativePath: string; createParents?: boolean };
        const createdDeck = toDeckEntry(FORGE_WORKSPACE_ROOT_PATH, input.relativePath);
        if (!decks.some((deck) => deck.absolutePath === createdDeck.absolutePath)) {
          decks = [...decks, createdDeck].sort((left, right) =>
            left.relativePath.localeCompare(right.relativePath),
          );
        }

        return {
          type: "success",
          data: {
            absolutePath: createdDeck.absolutePath,
          },
        };
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    await renderEditorApp(invoke);

    await expect
      .poll(() => {
        return (
          document.querySelector("[data-slot='combobox-trigger']") instanceof HTMLButtonElement
        );
      })
      .toBe(true);

    openDeckCombobox();
    await setDeckComboboxInputValue("test/test.md");
    await userEvent.keyboard("{Enter}");

    await expect.poll(() => getDeckSelectionText()).toContain("test/test.md");

    const createDeckCall = invoke.mock.calls.find(
      ([method]: unknown[]) => method === "CreateDeck",
    ) as [string, { relativePath: string; createParents?: boolean }] | undefined;
    expect(createDeckCall?.[1]).toEqual({
      relativePath: "test/test.md",
      createParents: true,
    });
  });

  it("keeps the deck combobox disabled when no workspace root is configured", async () => {
    const invoke = vi.fn().mockImplementation(async (method: string) => {
      if (method === "GetSettings") {
        return forgeSettingsSuccess(null);
      }

      return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
    });

    await renderEditorApp(invoke);

    await expect
      .element(page.getByText("No workspace configured. Set a workspace root path in settings."))
      .toBeVisible();
    await expect.poll(() => getDeckComboboxTrigger().disabled).toBe(true);
  });
});
