import { useState } from "react";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import { ProviderKeyRow } from "@/components/settings/provider-key-row";

describe("ProviderKeyRow", () => {
  it("renders provider name and preview when configured", async () => {
    const screen = await render(
      <ProviderKeyRow
        providerName="OpenAI"
        configured={true}
        saving={false}
        error={null}
        preview="••••••••••••"
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await expect.element(screen.getByText("OpenAI")).toBeVisible();
    await expect.element(screen.getByText("••••••••••••")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Add OpenAI key" }).query()).toBeNull();
  });

  it("shows Add key action for unconfigured provider", async () => {
    const screen = await render(
      <ProviderKeyRow
        providerName="Anthropic"
        configured={false}
        saving={false}
        error={null}
        preview="••••••••••••"
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await expect.element(screen.getByRole("button", { name: "Add Anthropic key" })).toBeVisible();
  });

  it("opens inline editor when Add key is clicked", async () => {
    const screen = await render(
      <ProviderKeyRow
        providerName="Anthropic"
        configured={false}
        saving={false}
        error={null}
        preview="••••••••••••"
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Add Anthropic key" }));

    await expect.element(screen.getByRole("textbox", { name: "Anthropic API key" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Save Anthropic key" })).toBeDisabled();
  });

  it("opens inline editor from Replace on hover", async () => {
    const screen = await render(
      <ProviderKeyRow
        providerName="OpenAI"
        configured={true}
        saving={false}
        error={null}
        preview="••••••••••••"
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    const row = screen.getByRole("group", { name: "OpenAI API key" });
    await userEvent.hover(row);
    await userEvent.click(screen.getByRole("button", { name: "Replace OpenAI key" }));

    await expect.element(screen.getByRole("textbox", { name: "OpenAI API key" })).toBeVisible();
  });

  it("opens inline editor when clicking configured key preview", async () => {
    const screen = await render(
      <ProviderKeyRow
        providerName="OpenAI"
        configured={true}
        saving={false}
        error={null}
        preview="••••••••••••"
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "OpenAI key preview" }));

    await expect.element(screen.getByRole("textbox", { name: "OpenAI API key" })).toBeVisible();
  });

  it("saves on Enter and trims value", async () => {
    const onSave = vi.fn();
    const screen = await render(
      <ProviderKeyRow
        providerName="Anthropic"
        configured={false}
        saving={false}
        error={null}
        preview="••••••••••••"
        onSave={onSave}
        onRemove={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Add Anthropic key" }));
    const input = screen.getByRole("textbox", { name: "Anthropic API key" });
    await userEvent.fill(input, "  sk-ant-test  ");
    await userEvent.keyboard("{Enter}");

    expect(onSave).toHaveBeenCalledWith("sk-ant-test");
  });

  it("cancels editor on Cancel click", async () => {
    const screen = await render(
      <ProviderKeyRow
        providerName="Anthropic"
        configured={false}
        saving={false}
        error={null}
        preview="••••••••••••"
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Add Anthropic key" }));
    const input = screen.getByRole("textbox", { name: "Anthropic API key" });
    await userEvent.fill(input, "sk-ant-test");

    await userEvent.click(screen.getByRole("button", { name: "Cancel Anthropic key edit" }));

    expect(screen.getByRole("textbox", { name: "Anthropic API key" }).query()).toBeNull();
  });

  it("cancels editor on Escape", async () => {
    const screen = await render(
      <ProviderKeyRow
        providerName="Anthropic"
        configured={false}
        saving={false}
        error={null}
        preview="••••••••••••"
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Add Anthropic key" }));
    const input = screen.getByRole("textbox", { name: "Anthropic API key" });
    await userEvent.fill(input, "sk-ant-test");
    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("textbox", { name: "Anthropic API key" }).query()).toBeNull();
  });

  it("keeps remove confirmation flow", async () => {
    const onRemove = vi.fn();
    const screen = await render(
      <ProviderKeyRow
        providerName="OpenAI"
        configured={true}
        saving={false}
        error={null}
        preview="••••••••••••"
        onSave={vi.fn()}
        onRemove={onRemove}
      />,
    );

    await userEvent.hover(screen.getByRole("group", { name: "OpenAI API key" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove OpenAI key" }));

    await expect.element(page.getByText("Remove API key")).toBeVisible();
    (document.querySelector("[data-slot='alert-dialog-action']") as HTMLElement).click();

    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("disables actions while saving", async () => {
    const screen = await render(
      <ProviderKeyRow
        providerName="OpenAI"
        configured={false}
        saving={true}
        error={null}
        preview="••••••••••••"
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await expect.element(screen.getByRole("button", { name: "Add OpenAI key" })).toBeDisabled();
  });

  it("renders row error message", async () => {
    const screen = await render(
      <ProviderKeyRow
        providerName="OpenAI"
        configured={false}
        saving={false}
        error="Failed to save key"
        preview="••••••••••••"
        onSave={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    await expect.element(screen.getByText("Failed to save key")).toBeVisible();
  });

  it("collapses and clears editor after successful save completes", async () => {
    function SuccessHarness() {
      const [configured, setConfigured] = useState(false);
      const [saving, setSaving] = useState(false);
      const [error, setError] = useState<string | null>(null);

      return (
        <ProviderKeyRow
          providerName="Anthropic"
          configured={configured}
          saving={saving}
          error={error}
          preview="••••••••••••"
          onSave={() => {
            setSaving(true);
            setError(null);
            setTimeout(() => {
              setConfigured(true);
              setSaving(false);
            }, 30);
          }}
          onRemove={vi.fn()}
        />
      );
    }

    const screen = await render(<SuccessHarness />);

    await userEvent.click(screen.getByRole("button", { name: "Add Anthropic key" }));
    const input = screen.getByRole("textbox", { name: "Anthropic API key" });
    await userEvent.fill(input, "sk-ant-success");
    await userEvent.click(screen.getByRole("button", { name: "Save Anthropic key" }));

    await expect.element(input).toHaveValue("sk-ant-success");
    await expect
      .poll(() => screen.getByRole("textbox", { name: "Anthropic API key" }).query())
      .toBeNull();
    await expect.element(screen.getByText("••••••••••••")).toBeVisible();
  });

  it("keeps editor open and preserves input after failed save", async () => {
    function FailureHarness() {
      const [saving, setSaving] = useState(false);
      const [error, setError] = useState<string | null>(null);

      return (
        <ProviderKeyRow
          providerName="Anthropic"
          configured={false}
          saving={saving}
          error={error}
          preview="••••••••••••"
          onSave={() => {
            setSaving(true);
            setError(null);
            setTimeout(() => {
              setSaving(false);
              setError("Failed to save key");
            }, 30);
          }}
          onRemove={vi.fn()}
        />
      );
    }

    const screen = await render(<FailureHarness />);

    await userEvent.click(screen.getByRole("button", { name: "Add Anthropic key" }));
    const input = screen.getByRole("textbox", { name: "Anthropic API key" });
    await userEvent.fill(input, "sk-ant-fail");
    await userEvent.click(screen.getByRole("button", { name: "Save Anthropic key" }));

    await expect.element(screen.getByText("Failed to save key")).toBeVisible();
    await expect
      .element(screen.getByRole("textbox", { name: "Anthropic API key" }))
      .toHaveValue("sk-ant-fail");
  });
});
