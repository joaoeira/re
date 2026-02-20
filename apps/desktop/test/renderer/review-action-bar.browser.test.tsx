import type { FSRSGrade } from "@shared/rpc/schemas/review";

import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";

import { ReviewActionBar } from "@/components/review-session/review-action-bar";
import { GradeButtons } from "@/components/review-session/grade-buttons";

describe("ReviewActionBar", () => {
  const noop = () => {};

  describe("reveal mode", () => {
    it("shows the Review label", async () => {
      const screen = await render(
        <ReviewActionBar
          mode="reveal"
          onReveal={noop}
          onGrade={noop}
          gradingDisabled={false}
          progress="3/10"
        />,
      );

      await expect.element(screen.getByText("Review")).toBeVisible();
    });

    it("shows the Show Answer button", async () => {
      const screen = await render(
        <ReviewActionBar
          mode="reveal"
          onReveal={noop}
          onGrade={noop}
          gradingDisabled={false}
          progress="1/5"
        />,
      );

      await expect.element(screen.getByText("Show Answer")).toBeVisible();
    });

    it("shows the Space keyboard hint", async () => {
      const screen = await render(
        <ReviewActionBar
          mode="reveal"
          onReveal={noop}
          onGrade={noop}
          gradingDisabled={false}
          progress="1/5"
        />,
      );

      await expect.element(screen.getByText("Space")).toBeVisible();
    });

    it("shows the progress counter", async () => {
      const screen = await render(
        <ReviewActionBar
          mode="reveal"
          onReveal={noop}
          onGrade={noop}
          gradingDisabled={false}
          progress="7/24"
        />,
      );

      await expect.element(screen.getByText("7/24")).toBeVisible();
    });

    it("does not show grade buttons", async () => {
      const screen = await render(
        <ReviewActionBar
          mode="reveal"
          onReveal={noop}
          onGrade={noop}
          gradingDisabled={false}
          progress="1/5"
        />,
      );

      expect(screen.getByText("Again").query()).toBeNull();
      expect(screen.getByText("Hard").query()).toBeNull();
      expect(screen.getByText("Good").query()).toBeNull();
      expect(screen.getByText("Easy").query()).toBeNull();
    });

    it("does not show the Grade label", async () => {
      const screen = await render(
        <ReviewActionBar
          mode="reveal"
          onReveal={noop}
          onGrade={noop}
          gradingDisabled={false}
          progress="1/5"
        />,
      );

      expect(screen.getByText("Grade").query()).toBeNull();
    });

    it("fires onReveal when the button is clicked", async () => {
      const onReveal = vi.fn();
      const screen = await render(
        <ReviewActionBar
          mode="reveal"
          onReveal={onReveal}
          onGrade={noop}
          gradingDisabled={false}
          progress="1/5"
        />,
      );

      await userEvent.click(screen.getByText("Show Answer"));
      expect(onReveal).toHaveBeenCalledOnce();
    });
  });

  describe("grade mode", () => {
    it("shows the Grade label", async () => {
      const screen = await render(
        <ReviewActionBar
          mode="grade"
          onReveal={noop}
          onGrade={noop}
          gradingDisabled={false}
          progress="3/10"
        />,
      );

      await expect.element(screen.getByText("Grade")).toBeVisible();
    });

    it("does not show the Review label", async () => {
      const screen = await render(
        <ReviewActionBar
          mode="grade"
          onReveal={noop}
          onGrade={noop}
          gradingDisabled={false}
          progress="3/10"
        />,
      );

      expect(screen.getByText("Review").query()).toBeNull();
    });

    it("shows all four grade buttons", async () => {
      const screen = await render(
        <ReviewActionBar
          mode="grade"
          onReveal={noop}
          onGrade={noop}
          gradingDisabled={false}
          progress="3/10"
        />,
      );

      await expect.element(screen.getByText("Again")).toBeVisible();
      await expect.element(screen.getByText("Hard")).toBeVisible();
      await expect.element(screen.getByText("Good")).toBeVisible();
      await expect.element(screen.getByText("Easy")).toBeVisible();
    });

    it("shows keyboard hints 1 through 4", async () => {
      const screen = await render(
        <ReviewActionBar
          mode="grade"
          onReveal={noop}
          onGrade={noop}
          gradingDisabled={false}
          progress="5/8"
        />,
      );

      await expect.element(screen.getByText("1", { exact: true })).toBeVisible();
      await expect.element(screen.getByText("2", { exact: true })).toBeVisible();
      await expect.element(screen.getByText("3", { exact: true })).toBeVisible();
      await expect.element(screen.getByText("4", { exact: true })).toBeVisible();
    });

    it("does not show the Show Answer button", async () => {
      const screen = await render(
        <ReviewActionBar
          mode="grade"
          onReveal={noop}
          onGrade={noop}
          gradingDisabled={false}
          progress="3/10"
        />,
      );

      expect(screen.getByText("Show Answer").query()).toBeNull();
    });

    it("shows the progress counter", async () => {
      const screen = await render(
        <ReviewActionBar
          mode="grade"
          onReveal={noop}
          onGrade={noop}
          gradingDisabled={false}
          progress="12/24"
        />,
      );

      await expect.element(screen.getByText("12/24")).toBeVisible();
    });

    it("fires onGrade with the correct grade for each button", async () => {
      const onGrade = vi.fn();
      const screen = await render(
        <ReviewActionBar
          mode="grade"
          onReveal={noop}
          onGrade={onGrade}
          gradingDisabled={false}
          progress="1/5"
        />,
      );

      await userEvent.click(screen.getByText("Again"));
      expect(onGrade).toHaveBeenLastCalledWith(0);

      await userEvent.click(screen.getByText("Hard"));
      expect(onGrade).toHaveBeenLastCalledWith(1);

      await userEvent.click(screen.getByText("Good"));
      expect(onGrade).toHaveBeenLastCalledWith(2);

      await userEvent.click(screen.getByText("Easy"));
      expect(onGrade).toHaveBeenLastCalledWith(3);

      expect(onGrade).toHaveBeenCalledTimes(4);
    });

    it("disables grade buttons when gradingDisabled is true", async () => {
      const screen = await render(
        <ReviewActionBar
          mode="grade"
          onReveal={noop}
          onGrade={noop}
          gradingDisabled={true}
          progress="1/5"
        />,
      );

      await expect.element(screen.getByText("Again").element().closest("button")!).toBeDisabled();
      await expect.element(screen.getByText("Hard").element().closest("button")!).toBeDisabled();
      await expect.element(screen.getByText("Good").element().closest("button")!).toBeDisabled();
      await expect.element(screen.getByText("Easy").element().closest("button")!).toBeDisabled();
    });

    it("does not fire onGrade when buttons are disabled", async () => {
      const onGrade = vi.fn();
      const screen = await render(
        <ReviewActionBar
          mode="grade"
          onReveal={noop}
          onGrade={onGrade}
          gradingDisabled={true}
          progress="1/5"
        />,
      );

      (screen.getByText("Again").element() as HTMLElement).click();
      (screen.getByText("Hard").element() as HTMLElement).click();
      (screen.getByText("Good").element() as HTMLElement).click();
      (screen.getByText("Easy").element() as HTMLElement).click();

      expect(onGrade).not.toHaveBeenCalled();
    });
  });
});

describe("GradeButtons", () => {
  it("renders all four labels", async () => {
    const screen = await render(<GradeButtons disabled={false} onGrade={() => {}} />);

    await expect.element(screen.getByText("Again")).toBeVisible();
    await expect.element(screen.getByText("Hard")).toBeVisible();
    await expect.element(screen.getByText("Good")).toBeVisible();
    await expect.element(screen.getByText("Easy")).toBeVisible();
  });

  it("renders keyboard hint for each grade", async () => {
    const screen = await render(<GradeButtons disabled={false} onGrade={() => {}} />);

    await expect.element(screen.getByText("1")).toBeVisible();
    await expect.element(screen.getByText("2")).toBeVisible();
    await expect.element(screen.getByText("3")).toBeVisible();
    await expect.element(screen.getByText("4")).toBeVisible();
  });

  it("maps each button to the correct FSRSGrade value", async () => {
    const onGrade = vi.fn();
    const screen = await render(<GradeButtons disabled={false} onGrade={onGrade} />);

    const expected: Array<[string, FSRSGrade]> = [
      ["Again", 0],
      ["Hard", 1],
      ["Good", 2],
      ["Easy", 3],
    ];

    for (const [label, grade] of expected) {
      await userEvent.click(screen.getByText(label));
      expect(onGrade).toHaveBeenLastCalledWith(grade);
    }
  });

  it("applies disabled state to all buttons", async () => {
    const screen = await render(<GradeButtons disabled={true} onGrade={() => {}} />);

    for (const label of ["Again", "Hard", "Good", "Easy"]) {
      const button = screen.getByText(label).element().closest("button")!;
      await expect.element(button).toBeDisabled();
    }
  });

  it("does not fire onGrade when disabled", async () => {
    const onGrade = vi.fn();
    const screen = await render(<GradeButtons disabled={true} onGrade={onGrade} />);

    for (const label of ["Again", "Hard", "Good", "Easy"]) {
      (screen.getByText(label).element() as HTMLElement).click();
    }

    expect(onGrade).not.toHaveBeenCalled();
  });
});
