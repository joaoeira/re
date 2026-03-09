import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import { GeneralSettings } from "@/components/settings/general-settings";

describe("GeneralSettings", () => {
  it("shows the current root path", async () => {
    const screen = await render(
      <GeneralSettings
        rootPath="/Users/test/workspace"
        saving={false}
        error={null}
        onSelectDirectory={vi.fn()}
        onClearRootPath={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
      />,
    );

    await expect.element(screen.getByText("/Users/test/workspace")).toBeVisible();
  });

  it("shows placeholder when no path is set", async () => {
    const screen = await render(
      <GeneralSettings
        rootPath={null}
        saving={false}
        error={null}
        onSelectDirectory={vi.fn()}
        onClearRootPath={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
      />,
    );

    await expect.element(screen.getByText("No folder selected")).toBeVisible();
  });

  it("hides the clear button when no path is set", async () => {
    const screen = await render(
      <GeneralSettings
        rootPath={null}
        saving={false}
        error={null}
        onSelectDirectory={vi.fn()}
        onClearRootPath={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Clear workspace path" }).query()).toBeNull();
  });

  it("shows the clear button when a path is set", async () => {
    const screen = await render(
      <GeneralSettings
        rootPath="/workspace"
        saving={false}
        error={null}
        onSelectDirectory={vi.fn()}
        onClearRootPath={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
      />,
    );

    await expect
      .element(screen.getByRole("button", { name: "Clear workspace path" }))
      .toBeVisible();
  });

  it("calls onSelectDirectory when Browse is clicked", async () => {
    const onSelectDirectory = vi.fn();
    const screen = await render(
      <GeneralSettings
        rootPath={null}
        saving={false}
        error={null}
        onSelectDirectory={onSelectDirectory}
        onClearRootPath={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Browse..." }));
    expect(onSelectDirectory).toHaveBeenCalledOnce();
  });

  it("calls onClearRootPath when clear button is clicked", async () => {
    const onClearRootPath = vi.fn();
    const screen = await render(
      <GeneralSettings
        rootPath="/workspace"
        saving={false}
        error={null}
        onSelectDirectory={vi.fn()}
        onClearRootPath={onClearRootPath}
        theme="system"
        onThemeChange={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Clear workspace path" }));
    expect(onClearRootPath).toHaveBeenCalledOnce();
  });

  it("disables buttons while saving", async () => {
    const screen = await render(
      <GeneralSettings
        rootPath="/workspace"
        saving={true}
        error={null}
        onSelectDirectory={vi.fn()}
        onClearRootPath={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
      />,
    );

    await expect.element(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: "Clear workspace path" }))
      .toBeDisabled();
  });

  it("renders all three theme options", async () => {
    const screen = await render(
      <GeneralSettings
        rootPath={null}
        saving={false}
        error={null}
        onSelectDirectory={vi.fn()}
        onClearRootPath={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
      />,
    );

    await expect.element(screen.getByRole("button", { name: "Light" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Dark" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "System" })).toBeVisible();
  });

  it("marks the active theme with aria-pressed", async () => {
    const screen = await render(
      <GeneralSettings
        rootPath={null}
        saving={false}
        error={null}
        onSelectDirectory={vi.fn()}
        onClearRootPath={vi.fn()}
        theme="dark"
        onThemeChange={vi.fn()}
      />,
    );

    await expect
      .element(screen.getByRole("button", { name: "Dark" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("button", { name: "Light" }))
      .toHaveAttribute("aria-pressed", "false");
    await expect
      .element(screen.getByRole("button", { name: "System" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("calls onThemeChange when a theme option is clicked", async () => {
    const onThemeChange = vi.fn();
    const screen = await render(
      <GeneralSettings
        rootPath={null}
        saving={false}
        error={null}
        onSelectDirectory={vi.fn()}
        onClearRootPath={vi.fn()}
        theme="system"
        onThemeChange={onThemeChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });

  it("shows an error message", async () => {
    const screen = await render(
      <GeneralSettings
        rootPath={null}
        saving={false}
        error="Failed to set workspace path"
        onSelectDirectory={vi.fn()}
        onClearRootPath={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
      />,
    );

    await expect.element(screen.getByText("Failed to set workspace path")).toBeVisible();
  });
});
