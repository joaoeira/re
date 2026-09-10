import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { parseFile } from "@simbyotic/re/core";
import type { EventPayload } from "@gpuix/react";
import { reviewKey } from "../src/review-controls";
import {
  createWorkspaceCard,
  readReviewCard,
  loadReview,
  loadReviewStatus,
  gradeInDeck,
  saveReviewEdit,
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

test("creating in a removed deck reports an actionable field error", async () => {
  const root = await mkdtemp(join(tmpdir(), "re-overlay-missing-"));
  try {
    expect(
      await createWorkspaceCard({
        deckPath: join(root, "missing.md"),
        cardType: "qa",
        question: "q",
        answer: "a",
        content: "",
      }),
    ).toMatchObject({
      _tag: "FieldError",
      field: "deckPath",
      message: "The selected deck no longer exists. Refresh the deck list.",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an invalid review edit keeps the field error and leaves the source deck unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "re-overlay-invalid-edit-"));
  try {
    const deck = join(root, "test.md");
    await writeFile(deck, "");
    await createWorkspaceCard({
      deckPath: deck,
      cardType: "qa",
      question: "Question",
      answer: "Answer",
      content: "",
    });
    const before = await readFile(deck, "utf8");
    const review = await loadReview(root);
    if (!review.ok) throw new Error(review.error);
    const card = review.value.cards[0];
    if (!card) throw new Error("Expected the created card in the review queue");
    expect(
      await saveReviewEdit(card, { cardType: "qa", question: "Question", answer: "" }),
    ).toEqual({
      ok: false,
      field: "answer",
      error: "Enter an answer.",
    });
    expect(await readFile(deck, "utf8")).toBe(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("menu status separates new, scheduled due, and total cards after grading", async () => {
  const root = await mkdtemp(join(tmpdir(), "re-overlay-status-"));
  try {
    const deck = join(root, "test.md");
    await writeFile(deck, "");
    await createWorkspaceCard({
      deckPath: deck,
      cardType: "qa",
      question: "q",
      answer: "a",
      content: "",
    });
    expect(await loadReviewStatus(root)).toMatchObject({
      ok: true,
      value: { new: 1, due: 0, total: 1, unavailableDecks: 0 },
    });
    const review = await loadReview(root);
    if (!review.ok) throw new Error(review.error);
    await gradeInDeck(review.value.cards[0]!, "good");
    expect(await loadReviewStatus(root)).toMatchObject({
      ok: true,
      value: { new: 0, due: 0, total: 1 },
    });
    expect(await loadReviewStatus(root, new Date(Date.now() + 11 * 60_000))).toMatchObject({
      ok: true,
      value: { new: 0, due: 1, total: 1 },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// These are application interactions through the real GPUI renderer, against
// disposable Markdown decks. They catch missing wiring as well as persistence bugs.
const nativePath = join(import.meta.dir, "../dist/gpuix-native.darwin-arm64.node");
const { existsSync } = await import("node:fs");
const nativeTest =
  process.platform === "darwin" &&
  existsSync(nativePath) &&
  existsSync(join(import.meta.dir, "../dist/libpanel.dylib"))
    ? test
    : test.skip;

async function mountApp(
  root: string,
  screen: "review" | "create" = "review",
  cardType: "qa" | "cloze" = "qa",
) {
  process.env.NAPI_RS_NATIVE_LIBRARY_PATH = nativePath;
  const { createTestRoot } = await import("@gpuix/react/testing");
  const { flushSync } = await import("@gpuix/react");
  const { createElement } = await import("react");
  const { App } = await import("../src/app");
  const events: import("../src/app").AppEvents = {
    key: () => {},
    route: () => {},
    refresh: () => {},
    preferences: () => {},
  };
  const view = createTestRoot({ width: 720, height: 465, onKeyDown: (event) => events.key(event) });
  view.render(
    createElement(App, {
      renderer: view.renderer,
      events,
      onQuit: () => {},
      initial: {
        screen,
        cards: [],
        preferences: { root, deck: join(root, "test.md"), cardType, closeAfterSubmit: false },
      },
    }),
  );
  const settle = async (predicate: () => boolean) => {
    for (let i = 0; i < 150; i++) {
      await Bun.sleep(10);
      view.renderer.flush();
      if (predicate()) return;
    }
    throw new Error(`UI did not settle: ${view.renderer.getAllText().join(" | ")}`);
  };
  const has = (text: string) => view.renderer.getAllText().some((node) => node.includes(text));
  const press = (keys: string) => view.renderer.simulateKeystrokes(keys);
  if (screen === "create") await settle(() => has("test"));
  return {
    view,
    settle,
    has,
    press,
    route: (screen: "create" | "review") => flushSync(() => events.route(screen)),
  };
}

nativeTest(
  "Again finishes a one-card session, and undo restores its schedule and review position",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "re-overlay-ui-review-"));
    let mounted: Awaited<ReturnType<typeof mountApp>> | undefined;
    try {
      const deck = join(root, "test.md");
      await writeFile(deck, "");
      await createWorkspaceCard({
        deckPath: deck,
        cardType: "qa",
        question: "One question",
        answer: "One answer",
        content: "",
      });
      mounted = await mountApp(root);
      const { view, settle, has, press } = mounted;
      await settle(() => has("Show answer"));
      press("space");
      await settle(() => has("Again"));
      press("1");
      await settle(() => has("Review complete"));
      expect(has("1 card reviewed") && has("Again 1 · Hard 0 · Good 0 · Easy 0")).toBe(true);
      expect(await loadReviewStatus(root)).toMatchObject({ ok: true, value: { new: 0, due: 0 } });
      press("cmd-z");
      await settle(() => has("Show answer"));
      expect(has("· 1 left")).toBe(true);
      expect(view.renderer.findByTestId("revealed-answer")).toBeUndefined();
      expect(await loadReviewStatus(root)).toMatchObject({ ok: true, value: { new: 1, due: 0 } });
    } finally {
      mounted?.view.unmount();
      await rm(root, { recursive: true, force: true });
    }
  },
);

nativeTest("review edit saves to the source deck and returns to an unrevealed card", async () => {
  const root = await mkdtemp(join(tmpdir(), "re-overlay-ui-edit-"));
  let mounted: Awaited<ReturnType<typeof mountApp>> | undefined;
  try {
    const deck = join(root, "test.md");
    await writeFile(deck, "");
    await createWorkspaceCard({
      deckPath: deck,
      cardType: "qa",
      question: "Question",
      answer: "Old answer",
      content: "",
    });
    mounted = await mountApp(root);
    const { view, settle, has, press } = mounted;
    await settle(() => has("Show answer"));
    press("space");
    await settle(() => !!view.renderer.findByTestId("revealed-answer"));
    press("cmd-e");
    await settle(() => !!view.renderer.findByTestId("edit-answer"));
    view.renderer.focusElement(view.renderer.findByTestId("edit-answer")!.id);
    press("cmd-a n e w");
    press("cmd-enter");
    await settle(() => has("Card updated") && has("Show answer"));
    const loaded = await loadReview(root);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(await readReviewCard(root, loaded.value.cards[0]!)).toMatchObject({
      ok: true,
      value: { prompt: "Question", reveal: "new" },
    });
    expect(view.renderer.findByTestId("revealed-answer")).toBeUndefined();
    press("space");
    await settle(() => !!view.renderer.findByTestId("revealed-answer"));
    expect(view.renderer.getPaintedText().join(" ")).toContain("new");
  } finally {
    mounted?.view.unmount();
    await rm(root, { recursive: true, force: true });
  }
});

nativeTest(
  "creation preview navigates cloze cards without saving, then creates them together",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "re-overlay-ui-preview-"));
    let mounted: Awaited<ReturnType<typeof mountApp>> | undefined;
    try {
      const deck = join(root, "test.md");
      await writeFile(deck, "");
      mounted = await mountApp(root, "create", "cloze");
      const { view, settle, has, press } = mounted;
      await settle(() => !!view.renderer.findByTestId("cloze-content"));
      view.renderer.focusElement(view.renderer.findByTestId("cloze-content")!.id);
      // Fill with native typing so draft state and preview wiring are exercised.
      press("cmd-a { { c 1 : : o n e } } space { { c 2 : : t w o } }");
      press("cmd-p");
      await settle(() => has("Preview · 1 of 2"));
      expect(view.renderer.getPaintedText().join(" ")).toContain("[...] two");
      expect(await readFile(deck, "utf8")).toBe("");
      press("alt-right");
      await settle(() => has("Preview · 2 of 2"));
      expect(view.renderer.getPaintedText().join(" ")).toContain("one [...]");
      expect(await readFile(deck, "utf8")).toBe("");
      press("cmd-enter");
      await settle(() => has("2 cards created"));
      const parsed = await Effect.runPromise(parseFile(await readFile(deck, "utf8")));
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0]!.cards).toHaveLength(2);
      expect(view.renderer.findByTestId("cloze-content")).toBeDefined();
    } finally {
      mounted?.view.unmount();
      await rm(root, { recursive: true, force: true });
    }
  },
);

nativeTest(
  "deleting a cloze note removes its sibling cards, and undo restores the note and queue",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "re-overlay-ui-delete-"));
    let mounted: Awaited<ReturnType<typeof mountApp>> | undefined;
    try {
      const deck = join(root, "test.md");
      await writeFile(deck, "");
      await createWorkspaceCard({
        deckPath: deck,
        cardType: "cloze",
        question: "",
        answer: "",
        content: "{{c1::one}} and {{c2::two}}",
      });
      mounted = await mountApp(root);
      const { settle, has, press } = mounted;
      await settle(() => has("Show answer"));
      press("cmd-backspace");
      await settle(() => has("Delete cloze note?"));
      press("cmd-enter");
      await settle(() => has("Review complete"));
      expect(await loadReviewStatus(root)).toMatchObject({ ok: true, value: { total: 0 } });
      press("cmd-z");
      await settle(() => has("Show answer"));
      expect(has("· 2 left")).toBe(true);
      expect(await loadReviewStatus(root)).toMatchObject({ ok: true, value: { new: 2, total: 2 } });
      expect(await readFile(deck, "utf8")).toContain("{{c1::one}} and {{c2::two}}");
    } finally {
      mounted?.view.unmount();
      await rm(root, { recursive: true, force: true });
    }
  },
);

for (const recovery of ["retry", "skip"] as const) {
  nativeTest(`${recovery} recovers from an unavailable card without grading it`, async () => {
    const root = await mkdtemp(join(tmpdir(), "re-overlay-ui-recovery-"));
    let mounted: Awaited<ReturnType<typeof mountApp>> | undefined;
    try {
      const deck = join(root, "test.md");
      await writeFile(deck, "");
      await createWorkspaceCard({
        deckPath: deck,
        cardType: "qa",
        question: "Question",
        answer: "Answer",
        content: "",
      });
      const original = await readFile(deck, "utf8");
      mounted = await mountApp(root);
      const { view, settle, has, press, route } = mounted;
      await settle(() => has("Show answer"));
      route("create");
      await writeFile(deck, "");
      route("review");
      await settle(() => has("Could not load this card"));
      // Restore the backing file while the error remains on screen. Either recovery
      // must leave its schedule untouched, including the skip path.
      await writeFile(deck, original);
      if (recovery === "retry") {
        press("cmd-r");
        await settle(() => has("Show answer") && !has("Could not load this card"));
      } else {
        const skip = view.renderer.findByText("Skip card")!;
        const bounds = view.renderer.getElementBounds(skip.id)!;
        view.renderer.nativeSimulateClick(bounds[0]! + bounds[2]! / 2, bounds[1]! + bounds[3]! / 2);
        await settle(() => !has("Could not load this card") && has("No cards due"));
      }
      expect(await readFile(deck, "utf8")).toBe(original);
    } finally {
      mounted?.view.unmount();
      await rm(root, { recursive: true, force: true });
    }
  });
}

nativeTest(
  "invalid creation keeps the draft and identifies the field that needs fixing",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "re-overlay-ui-validation-"));
    let mounted: Awaited<ReturnType<typeof mountApp>> | undefined;
    try {
      const deck = join(root, "test.md");
      await writeFile(deck, "");
      mounted = await mountApp(root, "create");
      const { view, settle, has, press } = mounted;
      await settle(() => !!view.renderer.findByTestId("question"));
      view.renderer.focusElement(view.renderer.findByTestId("question")!.id);
      press("q u e s t i o n cmd-enter");
      await settle(() => has("Enter an answer."));
      expect(await readFile(deck, "utf8")).toBe("");
      view.renderer.focusElement(view.renderer.findByTestId("answer")!.id);
      press("a n s w e r cmd-enter");
      await settle(() => has("Card created"));
      const loaded = await loadReview(root);
      if (!loaded.ok) throw new Error(loaded.error);
      expect(loaded.value.cards).toHaveLength(1);
      expect(await readReviewCard(root, loaded.value.cards[0]!)).toMatchObject({
        ok: true,
        value: { prompt: "question", reveal: "answer" },
      });
    } finally {
      mounted?.view.unmount();
      await rm(root, { recursive: true, force: true });
    }
  },
);

nativeTest("returning from preview restores the field being edited", async () => {
  const root = await mkdtemp(join(tmpdir(), "re-overlay-ui-focus-"));
  let mounted: Awaited<ReturnType<typeof mountApp>> | undefined;
  try {
    const deck = join(root, "test.md");
    await writeFile(deck, "");
    mounted = await mountApp(root, "create");
    const { view, settle, has, press } = mounted;
    await settle(() => !!view.renderer.findByTestId("question"));
    view.renderer.focusElement(view.renderer.findByTestId("question")!.id);
    press("q");
    view.renderer.focusElement(view.renderer.findByTestId("answer")!.id);
    press("a cmd-p");
    await settle(() => has("Preview · 1 of 1"));
    press("escape");
    await settle(() => !!view.renderer.findByTestId("answer"));
    press("x cmd-enter");
    await settle(() => has("Card created"));
    const loaded = await loadReview(root);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(await readReviewCard(root, loaded.value.cards[0]!)).toMatchObject({
      ok: true,
      value: { prompt: "q", reveal: "ax" },
    });
  } finally {
    mounted?.view.unmount();
    await rm(root, { recursive: true, force: true });
  }
});
