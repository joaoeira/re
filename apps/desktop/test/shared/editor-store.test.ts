import { beforeEach, describe, expect, it } from "vitest";

import { createEditorStore } from "@shared/state/editorStore";

type EditorStore = ReturnType<typeof createEditorStore>;
type Context = EditorStore extends { getSnapshot: () => { context: infer C } } ? C : never;

let store: EditorStore;
const ctx = (): Context => store.getSnapshot().context;

describe("editorStore", () => {
  beforeEach(() => {
    store = createEditorStore();
  });

  it("has correct initial defaults", () => {
    expect(ctx()).toMatchObject({
      mode: "create",
      cardType: "qa",
      deckPath: null,
      editCardId: null,
      editCardIds: [],
      frontContent: "",
      backContent: "",
      frontFrozen: false,
      backFrozen: false,
      dirty: false,
      isDuplicate: false,
      duplicateDeckPath: null,
      addedCount: 0,
      lastError: null,
      isSubmitting: false,
    });
  });

  describe("loadCreate", () => {
    it("sets mode, cardType, and deckPath", () => {
      store.send({ type: "loadCreate", deckPath: "/workspace/deck.md" });
      expect(ctx()).toMatchObject({
        mode: "create",
        cardType: "qa",
        deckPath: "/workspace/deck.md",
      });
    });

    it("clears edit fields, content, dirty, duplicate, error, submitting", () => {
      store.send({ type: "setFrontContent", content: "some text" });
      store.send({ type: "setBackContent", content: "answer" });
      store.send({ type: "setError", error: "something broke" });
      store.send({ type: "setDuplicate", isDuplicate: true, deckPath: "/dup.md" });
      store.send({ type: "setSubmitting", isSubmitting: true });

      store.send({ type: "loadCreate", deckPath: "/deck.md" });

      expect(ctx()).toMatchObject({
        editCardId: null,
        editCardIds: [],
        frontContent: "",
        backContent: "",
        dirty: false,
        isDuplicate: false,
        duplicateDeckPath: null,
        lastError: null,
        isSubmitting: false,
      });
    });

    it("accepts deckPath: null", () => {
      store.send({ type: "loadCreate", deckPath: null });
      expect(ctx().deckPath).toBeNull();
    });

    it("resets frontFrozen and backFrozen", () => {
      store.send({ type: "toggleFrontFrozen" });
      store.send({ type: "toggleBackFrozen" });
      expect(ctx().frontFrozen).toBe(true);
      expect(ctx().backFrozen).toBe(true);

      store.send({ type: "loadCreate", deckPath: null });
      expect(ctx().frontFrozen).toBe(false);
      expect(ctx().backFrozen).toBe(false);
    });

    it("resets addedCount", () => {
      store.send({ type: "loadCreate", deckPath: "/deck.md" });
      store.send({ type: "setFrontContent", content: "q" });
      store.send({ type: "setBackContent", content: "a" });
      store.send({ type: "itemSaved" });
      expect(ctx().addedCount).toBe(1);

      store.send({ type: "loadCreate", deckPath: "/deck.md" });
      expect(ctx().addedCount).toBe(0);
    });
  });

  describe("loadForEdit", () => {
    const qaEvent = {
      content: "front\n---\nback",
      cardType: "qa" as const,
      cardId: "card-1",
      cardIds: ["card-1", "card-2"],
      deckPath: "/deck.md",
    };

    it("splits QA content on separator", () => {
      store.send({ type: "loadForEdit", ...qaEvent });
      expect(ctx().frontContent).toBe("front");
      expect(ctx().backContent).toBe("back");
    });

    it("puts all content in frontContent when no separator", () => {
      store.send({
        type: "loadForEdit",
        ...qaEvent,
        content: "just front, no separator",
      });
      expect(ctx().frontContent).toBe("just front, no separator");
      expect(ctx().backContent).toBe("");
    });

    it("splits on first separator only", () => {
      store.send({
        type: "loadForEdit",
        ...qaEvent,
        content: "front\n---\nmiddle\n---\nend",
      });
      expect(ctx().frontContent).toBe("front");
      expect(ctx().backContent).toBe("middle\n---\nend");
    });

    it("handles separator-only content", () => {
      store.send({ type: "loadForEdit", ...qaEvent, content: "\n---\n" });
      expect(ctx().frontContent).toBe("");
      expect(ctx().backContent).toBe("");
    });

    it("handles separator at start", () => {
      store.send({ type: "loadForEdit", ...qaEvent, content: "\n---\nback only" });
      expect(ctx().frontContent).toBe("");
      expect(ctx().backContent).toBe("back only");
    });

    it("handles separator at end", () => {
      store.send({ type: "loadForEdit", ...qaEvent, content: "front only\n---\n" });
      expect(ctx().frontContent).toBe("front only");
      expect(ctx().backContent).toBe("");
    });

    it("treats bare --- without surrounding newlines as content", () => {
      store.send({ type: "loadForEdit", ...qaEvent, content: "before---after" });
      expect(ctx().frontContent).toBe("before---after");
      expect(ctx().backContent).toBe("");
    });

    it("trims whitespace", () => {
      store.send({
        type: "loadForEdit",
        ...qaEvent,
        content: "  front  \n---\n  back  ",
      });
      expect(ctx().frontContent).toBe("front");
      expect(ctx().backContent).toBe("back");
    });

    it("sets frontContent and empties backContent for cloze", () => {
      store.send({
        type: "loadForEdit",
        ...qaEvent,
        cardType: "cloze",
        content: "  {{c1::answer}}  ",
      });
      expect(ctx().frontContent).toBe("{{c1::answer}}");
      expect(ctx().backContent).toBe("");
    });

    it("resets dirty, duplicate, error, submitting", () => {
      store.send({ type: "setFrontContent", content: "dirty" });
      store.send({ type: "setDuplicate", isDuplicate: true, deckPath: "/dup.md" });
      store.send({ type: "setError", error: "old error" });
      store.send({ type: "setSubmitting", isSubmitting: true });

      store.send({ type: "loadForEdit", ...qaEvent });
      expect(ctx()).toMatchObject({
        dirty: false,
        isDuplicate: false,
        duplicateDeckPath: null,
        lastError: null,
        isSubmitting: false,
      });
    });

    it("resets frozen flags", () => {
      store.send({ type: "toggleFrontFrozen" });
      store.send({ type: "toggleBackFrozen" });

      store.send({ type: "loadForEdit", ...qaEvent });
      expect(ctx().frontFrozen).toBe(false);
      expect(ctx().backFrozen).toBe(false);
    });

    it("resets addedCount", () => {
      store.send({ type: "loadCreate", deckPath: "/deck.md" });
      store.send({ type: "setFrontContent", content: "q" });
      store.send({ type: "setBackContent", content: "a" });
      store.send({ type: "itemSaved" });
      expect(ctx().addedCount).toBe(1);

      store.send({ type: "loadForEdit", ...qaEvent });
      expect(ctx().addedCount).toBe(0);
    });
  });

  describe("detectCardType", () => {
    it("switches card type without touching content", () => {
      store.send({ type: "setFrontContent", content: "hello" });
      store.send({ type: "setBackContent", content: "world" });

      store.send({ type: "detectCardType", cardType: "cloze" });

      expect(ctx().cardType).toBe("cloze");
      expect(ctx().frontContent).toBe("hello");
      expect(ctx().backContent).toBe("world");
    });
  });

  describe("setDeckPath", () => {
    it("updates deckPath", () => {
      store.send({ type: "setDeckPath", deckPath: "/new.md" });
      expect(ctx().deckPath).toBe("/new.md");
    });

    it("clears with null", () => {
      store.send({ type: "setDeckPath", deckPath: "/deck.md" });
      store.send({ type: "setDeckPath", deckPath: null });
      expect(ctx().deckPath).toBeNull();
    });
  });

  describe("content and dirty", () => {
    it("setFrontContent updates content and marks dirty", () => {
      store.send({ type: "setFrontContent", content: "question" });
      expect(ctx().frontContent).toBe("question");
      expect(ctx().dirty).toBe(true);
    });

    it("setBackContent updates content and marks dirty", () => {
      store.send({ type: "setBackContent", content: "answer" });
      expect(ctx().backContent).toBe("answer");
      expect(ctx().dirty).toBe(true);
    });
  });

  describe("frozen toggles", () => {
    it("toggleFrontFrozen flips boolean", () => {
      expect(ctx().frontFrozen).toBe(false);
      store.send({ type: "toggleFrontFrozen" });
      expect(ctx().frontFrozen).toBe(true);
      store.send({ type: "toggleFrontFrozen" });
      expect(ctx().frontFrozen).toBe(false);
    });

    it("toggleBackFrozen flips boolean", () => {
      expect(ctx().backFrozen).toBe(false);
      store.send({ type: "toggleBackFrozen" });
      expect(ctx().backFrozen).toBe(true);
      store.send({ type: "toggleBackFrozen" });
      expect(ctx().backFrozen).toBe(false);
    });
  });

  describe("setDuplicate", () => {
    it("sets isDuplicate and duplicateDeckPath", () => {
      store.send({ type: "setDuplicate", isDuplicate: true, deckPath: "/dup.md" });
      expect(ctx().isDuplicate).toBe(true);
      expect(ctx().duplicateDeckPath).toBe("/dup.md");
    });
  });

  describe("setSubmitting", () => {
    it("toggles isSubmitting", () => {
      store.send({ type: "setSubmitting", isSubmitting: true });
      expect(ctx().isSubmitting).toBe(true);
      store.send({ type: "setSubmitting", isSubmitting: false });
      expect(ctx().isSubmitting).toBe(false);
    });
  });

  describe("setError", () => {
    it("sets and clears lastError", () => {
      store.send({ type: "setError", error: "something broke" });
      expect(ctx().lastError).toBe("something broke");
      store.send({ type: "setError", error: null });
      expect(ctx().lastError).toBeNull();
    });
  });

  describe("setEditIdentity", () => {
    it("updates editCardId and editCardIds", () => {
      store.send({
        type: "setEditIdentity",
        cardIds: ["a", "b", "c"],
        cardId: "b",
      });
      expect(ctx().editCardId).toBe("b");
      expect(ctx().editCardIds).toEqual(["a", "b", "c"]);
    });
  });

  describe("itemSaved", () => {
    beforeEach(() => {
      store.send({ type: "loadCreate", deckPath: "/deck.md" });
      store.send({ type: "setFrontContent", content: "question" });
      store.send({ type: "setBackContent", content: "answer" });
      store.send({ type: "setSubmitting", isSubmitting: true });
    });

    it("increments addedCount in create mode", () => {
      store.send({ type: "itemSaved" });
      expect(ctx().addedCount).toBe(1);
      store.send({ type: "setFrontContent", content: "q2" });
      store.send({ type: "setBackContent", content: "a2" });
      store.send({ type: "itemSaved" });
      expect(ctx().addedCount).toBe(2);
    });

    it("clears unfrozen content in create mode", () => {
      store.send({ type: "itemSaved" });
      expect(ctx().frontContent).toBe("");
      expect(ctx().backContent).toBe("");
    });

    it("preserves front when frontFrozen", () => {
      store.send({ type: "toggleFrontFrozen" });
      store.send({ type: "itemSaved" });
      expect(ctx().frontContent).toBe("question");
      expect(ctx().backContent).toBe("");
    });

    it("preserves back when backFrozen", () => {
      store.send({ type: "toggleBackFrozen" });
      store.send({ type: "itemSaved" });
      expect(ctx().frontContent).toBe("");
      expect(ctx().backContent).toBe("answer");
    });

    it("preserves both when both frozen", () => {
      store.send({ type: "toggleFrontFrozen" });
      store.send({ type: "toggleBackFrozen" });
      store.send({ type: "itemSaved" });
      expect(ctx().frontContent).toBe("question");
      expect(ctx().backContent).toBe("answer");
    });

    it("preserves content in edit mode with frozen flags off", () => {
      store.send({
        type: "loadForEdit",
        content: "front\n---\nback",
        cardType: "qa",
        cardId: "c1",
        cardIds: ["c1"],
        deckPath: "/deck.md",
      });
      store.send({ type: "setSubmitting", isSubmitting: true });
      store.send({ type: "itemSaved" });
      expect(ctx().frontContent).toBe("front");
      expect(ctx().backContent).toBe("back");
    });

    it("preserves content in edit mode with frozen flags on", () => {
      store.send({
        type: "loadForEdit",
        content: "front\n---\nback",
        cardType: "qa",
        cardId: "c1",
        cardIds: ["c1"],
        deckPath: "/deck.md",
      });
      store.send({ type: "toggleFrontFrozen" });
      store.send({ type: "toggleBackFrozen" });
      store.send({ type: "setSubmitting", isSubmitting: true });
      store.send({ type: "itemSaved" });
      expect(ctx().frontContent).toBe("front");
      expect(ctx().backContent).toBe("back");
    });

    it("does not increment addedCount in edit mode", () => {
      store.send({
        type: "loadForEdit",
        content: "front\n---\nback",
        cardType: "qa",
        cardId: "c1",
        cardIds: ["c1"],
        deckPath: "/deck.md",
      });
      store.send({ type: "setSubmitting", isSubmitting: true });
      store.send({ type: "itemSaved" });
      expect(ctx().addedCount).toBe(0);
    });

    it("resets dirty, duplicate, error, submitting", () => {
      store.send({ type: "setDuplicate", isDuplicate: true, deckPath: "/dup.md" });
      store.send({ type: "setError", error: "old" });
      store.send({ type: "itemSaved" });
      expect(ctx()).toMatchObject({
        dirty: false,
        isDuplicate: false,
        duplicateDeckPath: null,
        lastError: null,
        isSubmitting: false,
      });
    });
  });
});
