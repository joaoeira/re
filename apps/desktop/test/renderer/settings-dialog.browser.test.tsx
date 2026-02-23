import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import { IpcProvider } from "@/lib/ipc-context";
import { StoresProvider, createStores } from "@shared/state/stores-context";
import { SettingsDialog } from "@/components/settings/settings-dialog";

const defaultOnStreamFrame: NonNullable<Window["desktopApi"]["onStreamFrame"]> = () => {
  return () => undefined;
};

const mockDesktopApi = (
  invoke: (...args: unknown[]) => Promise<unknown>,
  subscribe: (...args: unknown[]) => () => void,
) => {
  Object.defineProperty(window, "desktopApi", {
    configurable: true,
    value: { invoke, subscribe, onStreamFrame: defaultOnStreamFrame },
  });
};

const defaultSettings = {
  settingsVersion: 1,
  workspace: { rootPath: "/workspace" },
};

const defaultInvoke = (overrides: Record<string, unknown> = {}) =>
  vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
    if (method in overrides) {
      return { type: "success", data: overrides[method] };
    }

    if (method === "GetSettings") {
      return { type: "success", data: defaultSettings };
    }

    if (method === "HasApiKey") {
      const key = (payload as { key: string }).key;
      if (key === "openai-api-key") return { type: "success", data: { configured: true } };
      return { type: "success", data: { configured: false } };
    }

    return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
  });

const defaultSubscribe = vi.fn().mockReturnValue(() => undefined);

const clickInDialog = (locator: ReturnType<typeof page.getByRole>) => {
  (locator.element() as HTMLElement).click();
};

async function renderSettingsDialog(invoke = defaultInvoke(), subscribe = defaultSubscribe) {
  mockDesktopApi(invoke, subscribe);

  const stores = createStores();
  const screen = await render(
    <IpcProvider>
      <StoresProvider stores={stores}>
        <SettingsDialog />
      </StoresProvider>
    </IpcProvider>,
  );

  stores.settings.send({ type: "openSettings" });

  await expect.element(page.getByRole("tablist")).toBeVisible();

  return { screen, stores, invoke };
}

describe("SettingsDialog", () => {
  describe("opening and navigation", () => {
    it("renders nothing when closed", async () => {
      mockDesktopApi(defaultInvoke(), defaultSubscribe);
      const stores = createStores();

      await render(
        <IpcProvider>
          <StoresProvider stores={stores}>
            <SettingsDialog />
          </StoresProvider>
        </IpcProvider>,
      );

      expect(document.querySelector("[data-slot='dialog-content']")).toBeNull();
    });

    it("shows dialog when store is opened", async () => {
      await renderSettingsDialog();
      await expect.element(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
    });

    it("starts on the General tab", async () => {
      await renderSettingsDialog();
      await expect
        .element(page.getByRole("tab", { name: "General" }))
        .toHaveAttribute("aria-selected", "true");
      await expect.element(page.getByText("Workspace root")).toBeVisible();
    });

    it("switches to Secrets tab on click", async () => {
      await renderSettingsDialog();
      clickInDialog(page.getByRole("tab", { name: "Secrets" }));

      await expect
        .element(page.getByRole("tab", { name: "Secrets" }))
        .toHaveAttribute("aria-selected", "true");
      await expect.element(page.getByText("API keys")).toBeVisible();
    });

    it("closes when store receives closeSettings", async () => {
      const { stores } = await renderSettingsDialog();

      await expect.element(page.getByRole("tabpanel")).toBeVisible();

      stores.settings.send({ type: "closeSettings" });

      await expect.poll(() => document.querySelector("[data-slot='dialog-content']")).toBeNull();
    });
  });

  describe("ARIA tab pattern", () => {
    it("links tabs to tabpanel via aria-controls and aria-labelledby", async () => {
      await renderSettingsDialog();

      const generalTab = page.getByRole("tab", { name: "General" });
      await expect.element(generalTab).toHaveAttribute("aria-controls", "settings-tabpanel");
      await expect.element(generalTab).toHaveAttribute("id", "settings-tab-general");

      const panel = page.getByRole("tabpanel");
      await expect.element(panel).toHaveAttribute("aria-labelledby", "settings-tab-general");
      await expect.element(panel).toHaveAttribute("id", "settings-tabpanel");
    });

    it("updates aria-labelledby when switching tabs", async () => {
      await renderSettingsDialog();
      clickInDialog(page.getByRole("tab", { name: "Secrets" }));

      await expect
        .element(page.getByRole("tabpanel"))
        .toHaveAttribute("aria-labelledby", "settings-tab-secrets");
    });

    it("uses roving tabindex on tabs", async () => {
      await renderSettingsDialog();

      await expect
        .element(page.getByRole("tab", { name: "General" }))
        .toHaveAttribute("tabindex", "0");
      await expect
        .element(page.getByRole("tab", { name: "Secrets" }))
        .toHaveAttribute("tabindex", "-1");
    });

    it("navigates tabs with arrow keys", async () => {
      await renderSettingsDialog();

      const generalTab = page.getByRole("tab", { name: "General" });
      (generalTab.element() as HTMLElement).focus();
      await userEvent.keyboard("{ArrowDown}");

      await expect
        .element(page.getByRole("tab", { name: "Secrets" }))
        .toHaveAttribute("aria-selected", "true");
      await expect.element(page.getByText("API keys")).toBeVisible();
    });
  });

  describe("General section", () => {
    it("loads and displays the workspace root path", async () => {
      await renderSettingsDialog();
      await expect.element(page.getByText("/workspace")).toBeVisible();
    });

    it("shows 'No folder selected' when rootPath is null", async () => {
      const invoke = defaultInvoke({
        GetSettings: { settingsVersion: 1, workspace: { rootPath: null } },
      });

      await renderSettingsDialog(invoke);
      await expect.element(page.getByText("No folder selected")).toBeVisible();
    });

    it("calls SelectDirectory then SetWorkspaceRootPath on Browse", async () => {
      const invoke = defaultInvoke();
      invoke.mockImplementation(async (method: string, payload?: unknown) => {
        if (method === "GetSettings") {
          return { type: "success", data: defaultSettings };
        }

        if (method === "HasApiKey") {
          return { type: "success", data: { configured: false } };
        }

        if (method === "SelectDirectory") {
          return { type: "success", data: { path: "/new/workspace" } };
        }

        if (method === "SetWorkspaceRootPath") {
          return {
            type: "success",
            data: {
              settingsVersion: 1,
              workspace: { rootPath: (payload as { rootPath: string }).rootPath },
            },
          };
        }

        return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
      });

      await renderSettingsDialog(invoke);
      await expect.element(page.getByText("/workspace")).toBeVisible();

      clickInDialog(page.getByRole("button", { name: "Browse..." }));

      await expect.element(page.getByText("/new/workspace")).toBeVisible();

      const selectCalls = invoke.mock.calls.filter(
        ([method]: unknown[]) => method === "SelectDirectory",
      );
      expect(selectCalls).toHaveLength(1);

      const setCalls = invoke.mock.calls.filter(
        ([method]: unknown[]) => method === "SetWorkspaceRootPath",
      );
      expect(setCalls).toHaveLength(1);
      expect(setCalls[0]![1]).toEqual({ rootPath: "/new/workspace" });
    });

    it("does not call SetWorkspaceRootPath when SelectDirectory is cancelled", async () => {
      const invoke = defaultInvoke();
      invoke.mockImplementation(async (method: string) => {
        if (method === "GetSettings") {
          return { type: "success", data: defaultSettings };
        }

        if (method === "HasApiKey") {
          return { type: "success", data: { configured: false } };
        }

        if (method === "SelectDirectory") {
          return { type: "success", data: { path: null } };
        }

        return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
      });

      await renderSettingsDialog(invoke);
      await expect.element(page.getByText("/workspace")).toBeVisible();

      clickInDialog(page.getByRole("button", { name: "Browse..." }));

      await expect.element(page.getByText("/workspace")).toBeVisible();

      const setCalls = invoke.mock.calls.filter(
        ([method]: unknown[]) => method === "SetWorkspaceRootPath",
      );
      expect(setCalls).toHaveLength(0);
    });

    it("clears workspace path on clear button click", async () => {
      const invoke = defaultInvoke();
      invoke.mockImplementation(async (method: string, payload?: unknown) => {
        if (method === "GetSettings") {
          return { type: "success", data: defaultSettings };
        }

        if (method === "HasApiKey") {
          return { type: "success", data: { configured: false } };
        }

        if (method === "SetWorkspaceRootPath") {
          return {
            type: "success",
            data: {
              settingsVersion: 1,
              workspace: { rootPath: (payload as { rootPath: string | null }).rootPath },
            },
          };
        }

        return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
      });

      await renderSettingsDialog(invoke);
      await expect.element(page.getByText("/workspace")).toBeVisible();

      clickInDialog(page.getByRole("button", { name: "Clear workspace path" }));

      await expect.element(page.getByText("No folder selected")).toBeVisible();

      const setCalls = invoke.mock.calls.filter(
        ([method]: unknown[]) => method === "SetWorkspaceRootPath",
      );
      expect(setCalls).toHaveLength(1);
      expect(setCalls[0]![1]).toEqual({ rootPath: null });
    });
  });

  describe("Secrets section", () => {
    it("loads and displays API key status", async () => {
      await renderSettingsDialog();
      clickInDialog(page.getByRole("tab", { name: "Secrets" }));

      await expect.element(page.getByText("OpenAI")).toBeVisible();
      await expect.element(page.getByText("Anthropic")).toBeVisible();
    });

    it("shows configured status from HasApiKey response", async () => {
      await renderSettingsDialog();
      clickInDialog(page.getByRole("tab", { name: "Secrets" }));

      await expect.element(page.getByText("Configured", { exact: true })).toBeVisible();
      await expect.element(page.getByText("Not configured", { exact: true })).toBeVisible();
    });

    it("saves an API key via SetApiKey then confirms via HasApiKey", async () => {
      const invoke = defaultInvoke();
      invoke.mockImplementation(async (method: string, payload?: unknown) => {
        if (method === "GetSettings") {
          return { type: "success", data: defaultSettings };
        }

        if (method === "HasApiKey") {
          const key = (payload as { key: string }).key;
          if (key === "anthropic-api-key") {
            const setKeyCalls = invoke.mock.calls.filter(
              ([m, p]: unknown[]) =>
                m === "SetApiKey" && (p as { key: string }).key === "anthropic-api-key",
            );
            return {
              type: "success",
              data: { configured: setKeyCalls.length > 0 },
            };
          }
          return { type: "success", data: { configured: false } };
        }

        if (method === "SetApiKey") {
          return { type: "success", data: { success: true } };
        }

        return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
      });

      await renderSettingsDialog(invoke);
      clickInDialog(page.getByRole("tab", { name: "Secrets" }));
      await expect.element(page.getByText("API keys")).toBeVisible();

      const inputs = document.querySelectorAll<HTMLInputElement>("input[type='password']");
      const anthropicInput = inputs[1]!;
      anthropicInput.focus();
      await userEvent.fill(anthropicInput, "sk-ant-test-123");

      const saveButtons = document.querySelectorAll<HTMLElement>("[data-slot='button']");
      const saveBtnArray = Array.from(saveButtons).filter((btn) => btn.textContent === "Save");
      saveBtnArray[1]!.click();

      const setKeyCalls = invoke.mock.calls.filter(([method]: unknown[]) => method === "SetApiKey");
      expect(setKeyCalls).toHaveLength(1);
      expect(setKeyCalls[0]![1]).toEqual({
        key: "anthropic-api-key",
        value: "sk-ant-test-123",
      });
    });

    it("removes an API key via DeleteApiKey after confirmation", async () => {
      const invoke = defaultInvoke();
      await renderSettingsDialog(invoke);
      clickInDialog(page.getByRole("tab", { name: "Secrets" }));
      await expect.element(page.getByText("Configured", { exact: true })).toBeVisible();

      const removeButton = document.querySelector(
        "[data-slot='alert-dialog-trigger']",
      ) as HTMLElement;
      removeButton.click();

      await expect.element(page.getByText("Remove API key")).toBeVisible();

      await expect
        .poll(() => {
          const btn = document.querySelector(
            "[data-slot='alert-dialog-action']",
          ) as HTMLElement | null;
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        })
        .toBe(true);

      const deleteCalls = invoke.mock.calls.filter(
        ([method]: unknown[]) => method === "DeleteApiKey",
      );
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0]![1]).toEqual({ key: "openai-api-key" });
    });
  });

  describe("loading and error states", () => {
    it("shows loading state while fetching data", async () => {
      const invoke = vi.fn().mockImplementation(() => new Promise(() => {}));

      mockDesktopApi(invoke, defaultSubscribe);

      const stores = createStores();
      await render(
        <IpcProvider>
          <StoresProvider stores={stores}>
            <SettingsDialog />
          </StoresProvider>
        </IpcProvider>,
      );

      stores.settings.send({ type: "openSettings" });
      await expect.element(page.getByText("Loading...")).toBeVisible();
    });

    it("shows error when settings fail to load", async () => {
      const invoke = vi.fn().mockImplementation(async (method: string) => {
        if (method === "GetSettings") {
          return {
            type: "failure",
            error: {
              tag: "SettingsReadFailed",
              data: { _tag: "SettingsReadFailed", path: "/tmp", message: "bad" },
            },
          };
        }

        return { type: "success", data: { configured: false } };
      });

      mockDesktopApi(invoke, defaultSubscribe);
      const stores = createStores();
      await render(
        <IpcProvider>
          <StoresProvider stores={stores}>
            <SettingsDialog />
          </StoresProvider>
        </IpcProvider>,
      );

      stores.settings.send({ type: "openSettings" });
      await expect.element(page.getByText("Failed to load settings")).toBeVisible();
    });
  });

  describe("section routing via store", () => {
    it("opens to a specific section via openSettingsSection", async () => {
      mockDesktopApi(defaultInvoke(), defaultSubscribe);

      const stores = createStores();
      await render(
        <IpcProvider>
          <StoresProvider stores={stores}>
            <SettingsDialog />
          </StoresProvider>
        </IpcProvider>,
      );

      stores.settings.send({ type: "openSettingsSection", section: "secrets" });
      await expect.element(page.getByText("API keys")).toBeVisible();
      await expect
        .element(page.getByRole("tab", { name: "Secrets" }))
        .toHaveAttribute("aria-selected", "true");
    });
  });
});
