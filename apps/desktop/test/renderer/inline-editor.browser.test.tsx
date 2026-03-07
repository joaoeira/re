import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { EditorField } from "@/components/editor/editor-field";
import { InlineEditor } from "@/components/forge/cards/inline-editor";

describe("InlineEditor math support", () => {
  it("renders inline math markdown as a math node", async () => {
    const screen = await render(<InlineEditor content={"Energy is $E=mc^2$."} />);

    await expect.element(screen.getByText("Energy is", { exact: false })).toBeVisible();

    const inlineMath = screen.container.querySelector("math-inline");
    expect(inlineMath).not.toBeNull();
    expect(inlineMath?.querySelector(".katex")).not.toBeNull();
    expect(screen.container.textContent).not.toContain("$E=mc^2$");
  });

  it("parses inline math when the content ends with an escaped backslash", async () => {
    const screen = await render(<InlineEditor content={"Path is $a\\\\$."} />);

    const inlineMath = screen.container.querySelector("math-inline");
    expect(inlineMath).not.toBeNull();
    expect(inlineMath?.querySelector(".katex")).not.toBeNull();
    expect(screen.container.textContent).not.toContain("$a\\\\$");
  });

  it("parses inline math with leading and trailing whitespace inside delimiters", async () => {
    const screen = await render(<InlineEditor content={"Spaces: $ x + y $."} />);

    const inlineMath = screen.container.querySelector("math-inline");
    expect(inlineMath).not.toBeNull();
    expect(inlineMath?.querySelector(".katex")).not.toBeNull();
    expect(screen.container.textContent).not.toContain("$ x + y $");
  });

  it("renders display math markdown as a display math node", async () => {
    const screen = await render(
      <InlineEditor content={"Before\n\n$$\nx^2 + y^2 = z^2\n$$\n\nAfter"} />,
    );

    await expect.element(screen.getByText("Before")).toBeVisible();
    await expect.element(screen.getByText("After")).toBeVisible();

    const displayMath = screen.container.querySelector("math-display");
    expect(displayMath).not.toBeNull();
    expect(displayMath?.querySelector(".katex-display")).not.toBeNull();
    expect(screen.container.textContent).not.toContain("$$");
  });

  it("renders markdown image content as an unresolved editor placeholder instead of raw markdown", async () => {
    const screen = await render(<InlineEditor content={"![Cell](../../.re/assets/cell.png)"} />);

    const placeholder = screen.container.querySelector(".editor-image-placeholder");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.textContent).toContain("cell.png");
    expect(screen.container.textContent).not.toContain("![Cell](../../.re/assets/cell.png)");
  });

  it("renders cloze-in-math as bracketed content instead of garbled KaTeX", async () => {
    const screen = await render(<InlineEditor content={"${{c1::mv}} = {{c2::np}}$"} />);

    const inlineMath = screen.container.querySelector("math-inline");
    expect(inlineMath).not.toBeNull();
    expect(inlineMath?.querySelector(".katex")).not.toBeNull();
    expect(inlineMath?.querySelector(".parse-error")).toBeNull();
    expect(inlineMath?.textContent).not.toContain("c1::");
    expect(inlineMath?.textContent).not.toContain("c2::");
  });

  it("renders cloze-in-math with LaTeX braces correctly", async () => {
    const screen = await render(<InlineEditor content={"$E = {{c1::mc^{2}}}$"} />);

    const inlineMath = screen.container.querySelector("math-inline");
    expect(inlineMath).not.toBeNull();
    expect(inlineMath?.querySelector(".katex")).not.toBeNull();
    expect(inlineMath?.querySelector(".parse-error")).toBeNull();
    expect(inlineMath?.textContent).not.toContain("c1::");
  });

  it("renders display math with cloze deletions correctly", async () => {
    const screen = await render(
      <InlineEditor content={"Before\n\n$$\n{{c1::x^2}} + {{c2::y^2}} = z^2\n$$\n\nAfter"} />,
    );

    const displayMath = screen.container.querySelector("math-display");
    expect(displayMath).not.toBeNull();
    expect(displayMath?.querySelector(".katex-display")).not.toBeNull();
    expect(displayMath?.querySelector(".parse-error")).toBeNull();
    expect(displayMath?.textContent).not.toContain("c1::");
  });

  it("renders plain math unchanged when no cloze syntax is present", async () => {
    const screen = await render(<InlineEditor content={"$E=mc^2$"} />);

    const inlineMath = screen.container.querySelector("math-inline");
    expect(inlineMath).not.toBeNull();
    expect(inlineMath?.querySelector(".katex")).not.toBeNull();
    expect(inlineMath?.querySelector(".parse-error")).toBeNull();
  });

  it("renders a file URL preview when deck context is available", async () => {
    const screen = await render(
      <EditorField
        label="Front"
        frozen={false}
        onToggleFreeze={() => undefined}
        content={"![Cell](../../.re/assets/cell.png)"}
        onContentChange={() => undefined}
        rootPath="/workspace"
        deckPath="/workspace/decks/biology/cell.md"
      />,
    );

    const image = screen.container.querySelector<HTMLImageElement>(".editor-image-preview");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe("re-asset://asset/.re/assets/cell.png");
  });
});
