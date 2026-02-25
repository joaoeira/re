import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import { ApiKeyField } from "@/components/settings/api-key-field";

describe("ApiKeyField", () => {
  it("shows 'Not configured' when key is not set", async () => {
    const screen = await render(
      <ApiKeyField
        label="OpenAI"
        configured={false}
        saving={false}
        error={null}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await expect.element(screen.getByText("Not configured")).toBeVisible();
    await expect.element(screen.getByText("OpenAI")).toBeVisible();
  });

  it("shows 'Configured' when key is set", async () => {
    const screen = await render(
      <ApiKeyField
        label="OpenAI"
        configured={true}
        saving={false}
        error={null}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await expect.element(screen.getByText("Configured")).toBeVisible();
  });

  it("disables Save when input is empty", async () => {
    const screen = await render(
      <ApiKeyField
        label="OpenAI"
        configured={false}
        saving={false}
        error={null}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("enables Save when input has text", async () => {
    const screen = await render(
      <ApiKeyField
        label="OpenAI"
        configured={false}
        saving={false}
        error={null}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await userEvent.fill(screen.getByPlaceholder("Enter API key"), "sk-test-123");
    await expect.element(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  it("calls onSave with trimmed value and clears input", async () => {
    const onSave = vi.fn();
    const screen = await render(
      <ApiKeyField
        label="OpenAI"
        configured={false}
        saving={false}
        error={null}
        onSave={onSave}
        onRemove={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholder("Enter API key");
    await userEvent.fill(input, "  sk-test-123  ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith("sk-test-123");
    await expect.element(input).toHaveValue("");
  });

  it("calls onSave on Enter key press", async () => {
    const onSave = vi.fn();
    const screen = await render(
      <ApiKeyField
        label="OpenAI"
        configured={false}
        saving={false}
        error={null}
        onSave={onSave}
        onRemove={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholder("Enter API key");
    await userEvent.fill(input, "sk-test-123");
    await userEvent.keyboard("{Enter}");

    expect(onSave).toHaveBeenCalledWith("sk-test-123");
  });

  it("does not call onSave when input is whitespace-only", async () => {
    const onSave = vi.fn();
    const screen = await render(
      <ApiKeyField
        label="OpenAI"
        configured={false}
        saving={false}
        error={null}
        onSave={onSave}
        onRemove={vi.fn()}
      />,
    );

    await userEvent.fill(screen.getByPlaceholder("Enter API key"), "   ");
    (screen.getByRole("button", { name: "Save" }).element() as HTMLElement).click();

    expect(onSave).not.toHaveBeenCalled();
  });

  it("hides Remove button when not configured", async () => {
    const screen = await render(
      <ApiKeyField
        label="OpenAI"
        configured={false}
        saving={false}
        error={null}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Remove" }).query()).toBeNull();
  });

  it("shows Remove button when configured", async () => {
    await render(
      <ApiKeyField
        label="OpenAI"
        configured={true}
        saving={false}
        error={null}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await expect.element(page.getByRole("button", { name: "Remove" })).toBeVisible();
  });

  it("shows Saving... while saving", async () => {
    const screen = await render(
      <ApiKeyField
        label="OpenAI"
        configured={false}
        saving={true}
        error={null}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await expect.element(screen.getByRole("button", { name: "Save OpenAI key" })).toBeDisabled();
    await expect.element(screen.getByText("Saving...")).toBeVisible();
  });

  it("shows an error message", async () => {
    const screen = await render(
      <ApiKeyField
        label="OpenAI"
        configured={false}
        saving={false}
        error="Failed to save key"
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await expect.element(screen.getByText("Failed to save key")).toBeVisible();
  });

  it("shows confirmation dialog on Remove click and calls onRemove on confirm", async () => {
    const onRemove = vi.fn();
    await render(
      <ApiKeyField
        label="OpenAI"
        configured={true}
        saving={false}
        error={null}
        onSave={vi.fn()}
        onRemove={onRemove}
      />,
    );

    await userEvent.click(page.getByRole("button", { name: "Remove" }));

    await expect.element(page.getByText("Remove API key")).toBeVisible();

    (document.querySelector("[data-slot='alert-dialog-action']") as HTMLElement).click();

    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("uses update placeholder when already configured", async () => {
    await render(
      <ApiKeyField
        label="OpenAI"
        configured={true}
        saving={false}
        error={null}
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await expect.element(page.getByPlaceholder("Enter new key to update")).toBeVisible();
  });
});
