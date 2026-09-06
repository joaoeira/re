import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { parseFile } from "@simbyotic/re/core";
import type { EventPayload } from "@gpuix/react";
import { reviewKey } from "../src/review-controls";
import {
  createInDeck,
  loadReview,
  gradeInDeck,
  prepareScratch,
  disposeWorkspace,
} from "../src/workspace";

const key = (key: string, extra: Partial<EventPayload> = {}): EventPayload => ({
  elementId: 1,
  eventType: "keyDown",
  key,
  ...extra,
});
afterAll(disposeWorkspace);

test("review requires reveal before grading, and held/modified keys cannot advance it", () => {
  expect(reviewKey(key("space"), false)).toBe("reveal");
  expect(reviewKey(key("space"), true)).toBe("good");
  for (const revealed of [false, true]) {
    expect(reviewKey(key("enter"), revealed)).toBeNull();
    expect(reviewKey(key("space", { isHeld: true }), revealed)).toBeNull();
    expect(reviewKey(key("1", { modifiers: { cmd: true } }), revealed)).toBeNull();
  }
  for (const digit of ["1", "2", "3", "4"]) expect(reviewKey(key(digit), false)).toBeNull();
});

test("numeric grades persist distinct FSRS schedules through the deck boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "re-pocket-grades-"));
  try {
    const deck = join(root, "test.md");
    await writeFile(deck, "");
    for (const digit of ["1", "2", "3", "4"]) {
      expect((await createInDeck(deck, { type: "qa", question: digit, answer: "answer" })).ok).toBe(
        true,
      );
    }
    const loaded = await loadReview(root);
    if (!loaded.ok) throw new Error(loaded.error);
    for (const card of loaded.value.cards) {
      const grade = reviewKey(key(card.question), true);
      if (!grade || grade === "reveal") throw new Error("Missing grade binding");
      expect((await gradeInDeck(card, grade)).ok).toBe(true);
    }
    const parsed = await Effect.runPromise(parseFile(await readFile(deck, "utf8")));
    const delays = parsed.items.map((item) => {
      const card = item.cards[0]!;
      expect(card.lastReview).not.toBeNull();
      expect(card.due).not.toBeNull();
      return card.due!.getTime() - card.lastReview!.getTime();
    });
    // Again, Hard, Good use distinct learning steps; Easy graduates to days.
    expect(delays[0]).toBe(60_000);
    expect(delays[1]).toBeGreaterThan(delays[0]!);
    expect(delays[1]).toBeLessThan(delays[2]!);
    expect(delays[2]).toBe(600_000);
    expect(delays[3]).toBeGreaterThanOrEqual(86_400_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace failures report plain messages rather than error class prefixes", async () => {
  expect(prepareScratch({ type: "qa", question: "", answer: "" })).toEqual({
    ok: false,
    error: "Enter a question.",
  });
  const missing = join(tmpdir(), "re-pocket-missing", "deck.md");
  expect(await createInDeck(missing, { type: "qa", question: "q", answer: "a" })).toEqual({
    ok: false,
    error: "The deck no longer exists.",
  });
});
