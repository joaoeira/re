import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import { SessionProgress } from "@/components/review-session/session-progress";

describe("SessionProgress", () => {
  it("renders current and total with spaced separator", async () => {
    const screen = await render(<SessionProgress current={3} total={30} />);

    await expect.element(screen.getByText("3 / 30")).toBeVisible();
  });

  it("renders 1-based index at start of session", async () => {
    const screen = await render(<SessionProgress current={1} total={15} />);

    await expect.element(screen.getByText("1 / 15")).toBeVisible();
  });

  it("renders final card index", async () => {
    const screen = await render(<SessionProgress current={15} total={15} />);

    await expect.element(screen.getByText("15 / 15")).toBeVisible();
  });
});
