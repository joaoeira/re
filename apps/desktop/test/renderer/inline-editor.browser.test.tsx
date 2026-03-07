import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

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
});
