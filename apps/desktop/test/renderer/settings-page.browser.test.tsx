import { useState } from "react";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { RouterProvider, createHashHistory, createRouter } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

import { IpcProvider } from "@/lib/ipc-context";
import { StoresProvider, createStores } from "@shared/state/stores-context";
import { SettingsPageProvider } from "@/components/settings/settings-page-context";
import { SettingsPage } from "@/components/settings/settings-page";
import type { SettingsSection } from "@/components/settings/settings-section";
import { routeTree } from "../../src/renderer/src/routeTree.gen";

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

const nativeClick = (locator: ReturnType<typeof page.getByRole>) => {
  (locator.element() as HTMLElement).click();
};

function SettingsHarness({ initialSection = "general" }: { initialSection?: SettingsSection }) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  return (
    <SettingsPageProvider>
      <SettingsPage section={section} onSectionChange={setSection} />
    </SettingsPageProvider>
  );
}

async function renderSettingsPage(
  invoke = defaultInvoke(),
  subscribe = defaultSubscribe,
  initialSection: SettingsSection = "general",
) {
  mockDesktopApi(invoke, subscribe);

  const screen = await render(
    <IpcProvider>
      <SettingsHarness initialSection={initialSection} />
    </IpcProvider>,
  );

  await expect.element(page.getByRole("tablist")).toBeVisible();

  return { screen, invoke };
}

async function renderAppAt(
  hashPath: string,
  invoke = defaultInvoke(),
  subscribe = defaultSubscribe,
) {
  mockDesktopApi(invoke, subscribe);
  window.location.hash = hashPath;

  const stores = createStores();
  const router = createRouter({ routeTree, history: createHashHistory() });

  const screen = await render(
    <IpcProvider>
      <SettingsPageProvider>
        <StoresProvider stores={stores}>
          <RouterProvider router={router} />
        </StoresProvider>
      </SettingsPageProvider>
    </IpcProvider>,
  );

  return { screen, stores, invoke, router };
}

describe("SettingsPage", () => {
  describe("rendering and navigation", () => {
    it("renders the settings page shell", async () => {
      await renderSettingsPage();
      await expect.element(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
    });

    it("starts on the General tab", async () => {
      await renderSettingsPage();
      await expect
        .element(page.getByRole("tab", { name: "General" }))
        .toHaveAttribute("aria-selected", "true");
      await expect.element(page.getByText("Workspace root")).toBeVisible();
    });

    it("switches to Secrets tab on click", async () => {
      await renderSettingsPage();
      nativeClick(page.getByRole("tab", { name: "Secrets" }));

      await expect
        .element(page.getByRole("tab", { name: "Secrets" }))
        .toHaveAttribute("aria-selected", "true");
      await expect.element(page.getByText("API keys")).toBeVisible();
    });
  });

  describe("ARIA tab pattern", () => {
    it("links tabs to tabpanel via aria-controls and aria-labelledby", async () => {
      await renderSettingsPage();

      const generalTab = page.getByRole("tab", { name: "General" });
      await expect.element(generalTab).toHaveAttribute("aria-controls", "settings-tabpanel");
      await expect.element(generalTab).toHaveAttribute("id", "settings-tab-general");

      const panel = page.getByRole("tabpanel");
      await expect.element(panel).toHaveAttribute("aria-labelledby", "settings-tab-general");
      await expect.element(panel).toHaveAttribute("id", "settings-tabpanel");
    });

    it("updates aria-labelledby when switching tabs", async () => {
      await renderSettingsPage();
      nativeClick(page.getByRole("tab", { name: "Secrets" }));

      await expect
        .element(page.getByRole("tabpanel"))
        .toHaveAttribute("aria-labelledby", "settings-tab-secrets");
    });

    it("uses roving tabindex on tabs", async () => {
      await renderSettingsPage();

      await expect
        .element(page.getByRole("tab", { name: "General" }))
        .toHaveAttribute("tabindex", "0");
      await expect
        .element(page.getByRole("tab", { name: "Secrets" }))
        .toHaveAttribute("tabindex", "-1");
    });

    it("navigates tabs with arrow keys", async () => {
      await renderSettingsPage();

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
      await renderSettingsPage();
      await expect.element(page.getByText("/workspace")).toBeVisible();
    });

    it("shows 'No folder selected' when rootPath is null", async () => {
      const invoke = defaultInvoke({
        GetSettings: { settingsVersion: 1, workspace: { rootPath: null } },
      });

      await renderSettingsPage(invoke);
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

      await renderSettingsPage(invoke);
      await expect.element(page.getByText("/workspace")).toBeVisible();

      nativeClick(page.getByRole("button", { name: "Browse..." }));

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

    it("shows an error when setting workspace path fails", async () => {
      const invoke = defaultInvoke();
      invoke.mockImplementation(async (method: string) => {
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
            type: "failure",
            error: {
              tag: "WorkspaceRootUnreadable",
              data: {
                _tag: "WorkspaceRootUnreadable",
                rootPath: "/new/workspace",
                message: "Permission denied",
              },
            },
          };
        }

        return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
      });

      await renderSettingsPage(invoke);
      nativeClick(page.getByRole("button", { name: "Browse..." }));
      await expect.element(page.getByText(/Failed to set workspace path/)).toBeVisible();
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

      await renderSettingsPage(invoke);
      await expect.element(page.getByText("/workspace")).toBeVisible();

      nativeClick(page.getByRole("button", { name: "Browse..." }));

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

      await renderSettingsPage(invoke);
      await expect.element(page.getByText("/workspace")).toBeVisible();

      nativeClick(page.getByRole("button", { name: "Clear workspace path" }));

      await expect.element(page.getByText("No folder selected")).toBeVisible();

      const setCalls = invoke.mock.calls.filter(
        ([method]: unknown[]) => method === "SetWorkspaceRootPath",
      );
      expect(setCalls).toHaveLength(1);
      expect(setCalls[0]![1]).toEqual({ rootPath: null });
    });
  });

  describe("Secrets section", () => {
    it("loads and displays provider rows", async () => {
      await renderSettingsPage();
      nativeClick(page.getByRole("tab", { name: "Secrets" }));

      await expect.element(page.getByText("OpenAI")).toBeVisible();
      await expect.element(page.getByText("Anthropic")).toBeVisible();
    });

    it("shows preview for configured keys and Add key for unconfigured providers", async () => {
      await renderSettingsPage();
      nativeClick(page.getByRole("tab", { name: "Secrets" }));

      await expect.element(page.getByLabelText("OpenAI key preview")).toBeVisible();
      await expect.element(page.getByRole("button", { name: "Add Anthropic key" })).toBeVisible();
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

      await renderSettingsPage(invoke);
      nativeClick(page.getByRole("tab", { name: "Secrets" }));
      await expect.element(page.getByText("API keys")).toBeVisible();

      await userEvent.click(page.getByRole("button", { name: "Add Anthropic key" }));
      const anthropicInput = page.getByRole("textbox", { name: "Anthropic API key" });
      await userEvent.click(anthropicInput);
      await userEvent.fill(anthropicInput, "sk-ant-test-123");
      nativeClick(page.getByRole("button", { name: "Save Anthropic key" }));

      const setKeyCalls = invoke.mock.calls.filter(([method]: unknown[]) => method === "SetApiKey");
      expect(setKeyCalls).toHaveLength(1);
      expect(setKeyCalls[0]![1]).toEqual({
        key: "anthropic-api-key",
        value: "sk-ant-test-123",
      });
    });

    it("shows an error when saving API key fails", async () => {
      const invoke = defaultInvoke();
      invoke.mockImplementation(async (method: string) => {
        if (method === "GetSettings") {
          return { type: "success", data: defaultSettings };
        }

        if (method === "HasApiKey") {
          return { type: "success", data: { configured: false } };
        }

        if (method === "SetApiKey") {
          return {
            type: "failure",
            error: {
              tag: "SecretStoreUnavailable",
              data: {
                _tag: "SecretStoreUnavailable",
                message: "keychain unavailable",
              },
            },
          };
        }

        return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
      });

      await renderSettingsPage(invoke);
      nativeClick(page.getByRole("tab", { name: "Secrets" }));
      await userEvent.click(page.getByRole("button", { name: "Add Anthropic key" }));
      const anthropicInput = page.getByRole("textbox", { name: "Anthropic API key" });
      await userEvent.click(anthropicInput);
      await userEvent.fill(anthropicInput, "sk-ant-test-123");
      nativeClick(page.getByRole("button", { name: "Save Anthropic key" }));

      await expect.element(page.getByText(/Failed to save key/)).toBeVisible();
    });

    it("removes an API key via DeleteApiKey after confirmation", async () => {
      const invoke = defaultInvoke();
      invoke.mockImplementation(async (method: string, payload?: unknown) => {
        if (method === "GetSettings") {
          return { type: "success", data: defaultSettings };
        }

        if (method === "HasApiKey") {
          const key = (payload as { key: string }).key;
          if (key === "openai-api-key") return { type: "success", data: { configured: true } };
          return { type: "success", data: { configured: false } };
        }

        if (method === "DeleteApiKey") {
          return { type: "success", data: { success: true } };
        }

        return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
      });

      await renderSettingsPage(invoke);
      nativeClick(page.getByRole("tab", { name: "Secrets" }));
      await userEvent.hover(page.getByRole("group", { name: "OpenAI API key" }));
      nativeClick(page.getByRole("button", { name: "Remove OpenAI key" }));

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

      await render(
        <IpcProvider>
          <SettingsHarness />
        </IpcProvider>,
      );

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

      await renderSettingsPage(invoke);
      await expect.element(page.getByText(/Failed to load settings/)).toBeVisible();
    });

    it("shows load error even when opened on Secrets section", async () => {
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

      await renderSettingsPage(invoke, defaultSubscribe, "secrets");
      await expect.element(page.getByText(/Failed to load settings/)).toBeVisible();
      await expect
        .element(page.getByRole("tab", { name: "Secrets" }))
        .toHaveAttribute("aria-selected", "true");
    });

    it("recovers after a load failure when retrying", async () => {
      let settingsRequests = 0;
      const invoke = vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
        if (method === "GetSettings") {
          settingsRequests += 1;
          if (settingsRequests === 1) {
            return {
              type: "failure",
              error: {
                tag: "SettingsReadFailed",
                data: { _tag: "SettingsReadFailed", path: "/tmp", message: "bad" },
              },
            };
          }
          return { type: "success", data: defaultSettings };
        }

        if (method === "HasApiKey") {
          const key = (payload as { key: string }).key;
          return {
            type: "success",
            data: { configured: key === "openai-api-key" },
          };
        }

        return { type: "failure", error: { code: "UNKNOWN_METHOD", message: method } };
      });

      await renderSettingsPage(invoke);
      await expect.element(page.getByText(/Failed to load settings/)).toBeVisible();

      nativeClick(page.getByRole("button", { name: "Retry" }));

      await expect.element(page.getByText("/workspace")).toBeVisible();
      expect(page.getByText(/Failed to load settings/).query()).toBeNull();
    });
  });

  describe("route-based section and triggers", () => {
    it("preloads settings state on app startup before opening /settings", async () => {
      const invoke = defaultInvoke();
      await renderAppAt("#/", invoke);

      await expect
        .poll(
          () => invoke.mock.calls.filter(([method]: unknown[]) => method === "HasApiKey").length,
        )
        .toBe(2);
    });

    it("defaults to General section on /settings", async () => {
      await renderAppAt("#/settings");

      await expect
        .element(page.getByRole("tab", { name: "General" }))
        .toHaveAttribute("aria-selected", "true");
      await expect.element(page.getByText("Workspace root")).toBeVisible();
    });

    it("opens Secrets section from /settings?section=secrets", async () => {
      const { router } = await renderAppAt("#/settings");
      await router.navigate({
        to: "/settings",
        search: { section: "secrets" },
      });

      await expect
        .element(page.getByRole("tab", { name: "Secrets" }))
        .toHaveAttribute("aria-selected", "true");
      await expect.element(page.getByText("API keys")).toBeVisible();
    });

    it("normalizes invalid section values to General", async () => {
      const { router } = await renderAppAt("#/settings");
      await router.navigate({
        to: "/settings",
        search: { section: "invalid" as never } as never,
      });

      await expect
        .element(page.getByRole("tab", { name: "General" }))
        .toHaveAttribute("aria-selected", "true");
      await expect.element(page.getByText("Workspace root")).toBeVisible();
    });

    it("navigates to settings when clicking the sidebar Settings button", async () => {
      await renderAppAt("#/");

      nativeClick(page.getByRole("button", { name: "Settings" }));

      await expect.element(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
      await expect.poll(() => window.location.hash).toContain("/settings");
    });

    it("navigates to settings on Cmd/Ctrl + ,", async () => {
      await renderAppAt("#/");

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ",",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      await expect.element(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
      await expect.poll(() => window.location.hash).toContain("/settings");
    });

    it("navigates to settings on Cmd/Ctrl + , from /editor", async () => {
      await renderAppAt("#/editor");

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ",",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      await expect.element(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
      await expect.poll(() => window.location.hash).toContain("/settings");
    });

    it("keeps current settings section when Cmd/Ctrl + , is pressed on settings", async () => {
      const { router } = await renderAppAt("#/settings");
      await router.navigate({
        to: "/settings",
        search: { section: "secrets" },
      });

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ",",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      await expect
        .element(page.getByRole("tab", { name: "Secrets" }))
        .toHaveAttribute("aria-selected", "true");
      await expect.poll(() => window.location.hash).toContain("section=secrets");
    });
  });
});
