import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import { SessionProgress } from "@/components/review-session/session-progress";

describe("SessionProgress", () => {
  it("renders the number of cards remaining", async () => {
    const screen = await render(<SessionProgress done={3} total={30} />);

    await expect.element(screen.getByText("27 remaining")).toBeVisible();
  });

  it("renders full total remaining at start of session", async () => {
    const screen = await render(<SessionProgress done={0} total={15} />);

    await expect.element(screen.getByText("15 remaining")).toBeVisible();
  });

  it("renders zero remaining after all cards are done", async () => {
    const screen = await render(<SessionProgress done={15} total={15} />);

    await expect.element(screen.getByText("0 remaining")).toBeVisible();
  });
});
