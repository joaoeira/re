import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { ClozePreview } from "@/components/editor/cloze-preview";

describe("ClozePreview", () => {
  it("returns null when no cloze syntax", async () => {
    const screen = await render(<ClozePreview content="plain text" />);
    expect(screen.container.innerHTML).toBe("");
  });

  it("renders single cloze answer", async () => {
    const screen = await render(<ClozePreview content="The {{c1::answer}} is here" />);
    await expect.element(screen.getByText("answer")).toBeVisible();
    await expect.element(screen.getByText("is here")).toBeVisible();
  });

  it("renders hint text with separator", async () => {
    const screen = await render(<ClozePreview content="{{c1::answer::hint}}" />);
    await expect.element(screen.getByText("answer")).toBeVisible();
    await expect.element(screen.getByText("hint", { exact: false })).toBeVisible();
  });

  it("renders multiple clozes", async () => {
    const screen = await render(<ClozePreview content="{{c1::first}} and {{c2::second}}" />);
    await expect.element(screen.getByText("first")).toBeVisible();
    await expect.element(screen.getByText("second")).toBeVisible();
    await expect.element(screen.getByText("and", { exact: false })).toBeVisible();
  });

  it("returns null for unclosed cloze syntax", async () => {
    const screen = await render(<ClozePreview content="{{c1:: no closing" />);
    expect(screen.container.innerHTML).toBe("");
  });

  it("renders empty answer as a cloze span", async () => {
    const screen = await render(<ClozePreview content="test {{c1::}} end" />);
    await expect.element(screen.getByText("test")).toBeVisible();
    await expect.element(screen.getByText("end")).toBeVisible();
    const spans = screen.container.querySelectorAll("span.border-dashed");
    expect(spans.length).toBe(1);
  });

  it("handles multiline content inside cloze", async () => {
    const screen = await render(<ClozePreview content={"{{c1::line1\nline2}}"} />);
    const clozeSpan = screen.container.querySelector("span.border-dashed");
    expect(clozeSpan).not.toBeNull();
    expect(clozeSpan!.textContent).toContain("line1");
    expect(clozeSpan!.textContent).toContain("line2");
  });

  it("partially matches nested braces", async () => {
    const screen = await render(<ClozePreview content="{{c1::{{nested}}}}" />);
    const container = screen.container.textContent;
    expect(container).toContain("{{nested");
  });

  it("handles adjacent clozes", async () => {
    const screen = await render(<ClozePreview content="{{c1::a}}{{c2::b}}" />);
    await expect.element(screen.getByText("a")).toBeVisible();
    await expect.element(screen.getByText("b")).toBeVisible();
  });

  it("handles content with only cloze", async () => {
    const screen = await render(<ClozePreview content="{{c1::only}}" />);
    await expect.element(screen.getByText("only")).toBeVisible();
  });

  it("handles multi-digit index", async () => {
    const screen = await render(<ClozePreview content="{{c12::answer}}" />);
    await expect.element(screen.getByText("answer")).toBeVisible();
  });
});
