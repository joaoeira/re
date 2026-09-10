import { expect, test } from "bun:test";
import { statusMenu } from "../src/review-status";

test("menu bar badge is due-only, hides at zero, and exposes separate counts", () => {
  const model = statusMenu({ ok: true, value: { due: 2, new: 3, total: 8, unavailableDecks: 1 } });
  expect(model.title).toBe("2");
  expect(model.items).toContainEqual(expect.objectContaining({ title: "3 new cards" }));
  expect(model.items).toContainEqual(expect.objectContaining({ title: "8 total cards" }));
  expect(model.items).toContainEqual(expect.objectContaining({ title: "1 deck unavailable" }));
  expect(
    statusMenu({ ok: true, value: { due: 0, new: 3, total: 8, unavailableDecks: 0 } }),
  ).toMatchObject({
    title: "",
    tooltip: "No cards due now",
  });
});

test("status failures replace counts while keeping recovery and navigation actions", () => {
  const model = statusMenu({ ok: false, error: "Folder no longer exists" });
  expect(model).toMatchObject({ title: "", tooltip: "Could not load review status" });
  expect(model.items).toContainEqual({ title: "Folder no longer exists" });
  for (const title of [
    "Review Cards",
    "Create Card",
    "Refresh",
    "Choose Workspace…",
    "Quit re Overlay",
  ]) {
    expect(model.items).toContainEqual(
      expect.objectContaining({ title, route: expect.any(Number) }),
    );
  }
});
