import { Option } from "effect";
import { createActor, type ActorRefFrom } from "xstate";
import { describe, expect, it, vi } from "vitest";

import {
  createEditorSessionMachine,
  type DeckEntry,
  type EditorSearchParams,
  type EditorSessionServices,
} from "@/machines/editorSession";

const deck = (input: { absolutePath: string; relativePath: string; name: string }): DeckEntry => ({
  absolutePath: input.absolutePath,
  relativePath: input.relativePath,
  name: input.name,
});

const primaryDeck = deck({
  absolutePath: "/workspace/deck-a.md",
  relativePath: "deck-a.md",
  name: "deck-a",
});

const secondaryDeck = deck({
  absolutePath: "/workspace/deck-b.md",
  relativePath: "deck-b.md",
  name: "deck-b",
});

const createServices = (overrides: Partial<EditorSessionServices> = {}): EditorSessionServices => ({
  getSettings: async () => ({
    workspace: {
      rootPath: "/workspace",
    },
  }),
  scanDecks: async () => ({ decks: [primaryDeck, secondaryDeck] }),
  getItemForEdit: async () => ({
    content: "front\n---\nback",
    cardType: "qa",
    cardIds: ["card-1", "card-2"],
  }),
  checkDuplicates: async () => ({
    isDuplicate: false,
    matchingDeckPath: Option.none(),
  }),
  appendItem: async () => ({}),
  replaceItem: async () => ({ cardIds: ["card-1", "card-2"] }),
  createDeck: async () => ({ absolutePath: "/workspace/new-deck.md" }),
  ...overrides,
});

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const waitForSnapshot = async (
  actor: ActorRefFrom<ReturnType<typeof createEditorSessionMachine>>,
  predicate: (snapshot: ReturnType<typeof actor.getSnapshot>) => boolean,
  timeoutMs = 1500,
) =>
  new Promise<ReturnType<typeof actor.getSnapshot>>((resolve, reject) => {
    const current = actor.getSnapshot();
    if (predicate(current)) {
      resolve(current);
      return;
    }

    const timeoutId = setTimeout(() => {
      subscription.unsubscribe();
      reject(new Error(`Timed out waiting for state ${JSON.stringify(actor.getSnapshot().value)}`));
    }, timeoutMs);

    const subscription = actor.subscribe((snapshot) => {
      if (!predicate(snapshot)) {
        return;
      }

      clearTimeout(timeoutId);
      subscription.unsubscribe();
      resolve(snapshot);
    });
  });

const startSession = (search: EditorSearchParams, services: EditorSessionServices) => {
  const actor = createActor(createEditorSessionMachine(services, search));
  actor.start();
  return actor;
};

describe("editorSessionMachine", () => {
  it("boots create mode and selects the first available deck", async () => {
    const services = createServices({
      scanDecks: vi.fn(async () => ({ decks: [primaryDeck, secondaryDeck] })),
    });
    const actor = startSession({ mode: "create" }, services);

    try {
      const ready = await waitForSnapshot(actor, (snapshot) => snapshot.matches("ready"));

      expect(ready.context.loading).toBe(false);
      expect(ready.context.mode).toBe("create");
      expect(ready.context.deckPath).toBe(primaryDeck.absolutePath);
      expect(services.scanDecks).toHaveBeenCalledWith({ rootPath: "/workspace" });
    } finally {
      actor.stop();
    }
  });

  it("detects cloze cards synchronously on front-content updates", async () => {
    vi.useFakeTimers();
    const checkDuplicates = vi.fn(async () => ({
      isDuplicate: false,
      matchingDeckPath: Option.none<string>(),
    }));
    const services = createServices({ checkDuplicates });
    const actor = startSession({ mode: "create" }, services);

    try {
      await waitForSnapshot(actor, (snapshot) => snapshot.matches("ready"));

      actor.send({ type: "SET_FRONT_CONTENT", content: "{{c1::answer}}" });
      expect(actor.getSnapshot().context.cardType).toBe("cloze");

      await vi.advanceTimersByTimeAsync(450);
      expect(checkDuplicates).toHaveBeenCalledWith({
        content: "{{c1::answer}}",
        cardType: "cloze",
        rootPath: "/workspace",
        excludeCardIds: [],
      });

      actor.send({ type: "SET_FRONT_CONTENT", content: "plain question" });
      expect(actor.getSnapshot().context.cardType).toBe("qa");
    } finally {
      actor.stop();
      vi.useRealTimers();
    }
  });

  it("submits create cards and emits a timed flash message", async () => {
    vi.useFakeTimers();
    const appendItem = vi.fn(async () => ({}));
    const checkDuplicates = vi.fn(async () => ({
      isDuplicate: false,
      matchingDeckPath: Option.none<string>(),
    }));
    const services = createServices({ appendItem, checkDuplicates });
    const actor = startSession({ mode: "create" }, services);

    try {
      await waitForSnapshot(actor, (snapshot) => snapshot.matches("ready"));

      actor.send({ type: "SET_FRONT_CONTENT", content: "front" });
      actor.send({ type: "SET_BACK_CONTENT", content: "back" });
      actor.send({ type: "SUBMIT" });

      const saved = await waitForSnapshot(
        actor,
        (snapshot) =>
          snapshot.matches("ready") &&
          snapshot.context.addedCount === 1 &&
          snapshot.context.flashMessage !== null,
      );

      expect(saved.context.frontContent).toBe("");
      expect(saved.context.backContent).toBe("");
      expect(appendItem).toHaveBeenCalledWith({
        deckPath: primaryDeck.absolutePath,
        content: "front\n---\nback",
        cardType: "qa",
      });

      await vi.advanceTimersByTimeAsync(2600);
      expect(actor.getSnapshot().context.flashMessage).toBeNull();
    } finally {
      actor.stop();
      vi.useRealTimers();
    }
  });

  it("rechecks duplicates during submit and blocks writes when duplicate", async () => {
    const appendItem = vi.fn(async () => ({}));
    const checkDuplicates = vi.fn(async () => ({
      isDuplicate: true,
      matchingDeckPath: Option.some("/workspace/other.md"),
    }));
    const services = createServices({ appendItem, checkDuplicates });
    const actor = startSession({ mode: "create" }, services);

    try {
      await waitForSnapshot(actor, (snapshot) => snapshot.matches("ready"));

      actor.send({ type: "SET_FRONT_CONTENT", content: "front" });
      actor.send({ type: "SET_BACK_CONTENT", content: "back" });
      actor.send({ type: "SUBMIT" });

      const duplicate = await waitForSnapshot(
        actor,
        (snapshot) => snapshot.matches("ready") && snapshot.context.isDuplicate,
      );

      expect(duplicate.context.lastError).toBe(
        "Duplicate content detected. Change the card before saving.",
      );
      expect(duplicate.context.duplicateDeckPath).toBe("/workspace/other.md");
      expect(appendItem).not.toHaveBeenCalled();
    } finally {
      actor.stop();
    }
  });

  it("refreshes deck list and clears invalid selected deck", async () => {
    const scanDecks = vi
      .fn<EditorSessionServices["scanDecks"]>()
      .mockResolvedValueOnce({ decks: [primaryDeck, secondaryDeck] })
      .mockResolvedValueOnce({ decks: [primaryDeck] });

    const services = createServices({ scanDecks });
    const actor = startSession({ mode: "create" }, services);

    try {
      await waitForSnapshot(actor, (snapshot) => snapshot.matches("ready"));

      actor.send({ type: "SET_DECK_PATH", deckPath: secondaryDeck.absolutePath });
      actor.send({ type: "REFRESH_DECKS" });

      const refreshed = await waitForSnapshot(
        actor,
        (snapshot) => snapshot.matches("ready") && snapshot.context.deckPath === null,
      );

      expect(refreshed.context.lastError).toBe(
        "The selected deck no longer exists in the current workspace.",
      );
      expect(refreshed.context.decks).toEqual([primaryDeck]);
    } finally {
      actor.stop();
    }
  });

  it("preserves create-mode edits typed while submit is in flight", async () => {
    const appendDeferred = createDeferred<Record<string, never>>();
    const services = createServices({
      appendItem: vi.fn(async () => appendDeferred.promise),
    });
    const actor = startSession({ mode: "create" }, services);

    try {
      await waitForSnapshot(actor, (snapshot) => snapshot.matches("ready"));

      actor.send({ type: "SET_FRONT_CONTENT", content: "question" });
      actor.send({ type: "SET_BACK_CONTENT", content: "answer" });
      actor.send({ type: "SUBMIT" });
      await waitForSnapshot(actor, (snapshot) =>
        snapshot.matches({ ready: { operations: "submitting" } }),
      );

      actor.send({ type: "SET_FRONT_CONTENT", content: "typed while submitting" });
      expect(actor.getSnapshot().context.frontContent).toBe("typed while submitting");

      appendDeferred.resolve({});
      const settled = await waitForSnapshot(actor, (snapshot) =>
        snapshot.matches({ ready: { operations: "idle" } }),
      );
      expect(settled.context.frontContent).toBe("typed while submitting");
      expect(settled.context.backContent).toBe("answer");
      expect(settled.context.dirty).toBe(true);
      expect(settled.context.addedCount).toBe(1);
    } finally {
      actor.stop();
    }
  });

  it("preserves edit-mode dirty state when typing during submit", async () => {
    const replaceDeferred = createDeferred<{ cardIds: readonly string[] }>();
    const services = createServices({
      getItemForEdit: vi.fn(async () => ({
        content: "prompt\n---\nanswer",
        cardType: "qa" as const,
        cardIds: ["card-1", "card-2"],
      })),
      replaceItem: vi.fn(async () => replaceDeferred.promise),
    });
    const actor = startSession(
      { mode: "edit", deckPath: primaryDeck.absolutePath, cardId: "card-2" },
      services,
    );

    try {
      await waitForSnapshot(actor, (snapshot) => snapshot.matches("ready"));

      actor.send({ type: "SET_FRONT_CONTENT", content: "updated once" });
      actor.send({ type: "SUBMIT" });
      await waitForSnapshot(actor, (snapshot) =>
        snapshot.matches({ ready: { operations: "submitting" } }),
      );

      actor.send({ type: "SET_FRONT_CONTENT", content: "updated twice while submitting" });
      replaceDeferred.resolve({ cardIds: ["card-1-new", "card-2-new"] });

      const settled = await waitForSnapshot(
        actor,
        (snapshot) =>
          snapshot.matches({ ready: { operations: "idle" } }) &&
          snapshot.context.editCardId === "card-2-new",
      );
      expect(settled.context.frontContent).toBe("updated twice while submitting");
      expect(settled.context.dirty).toBe(true);
    } finally {
      actor.stop();
    }
  });

  it("handles workspace refresh while submit is in flight", async () => {
    const appendDeferred = createDeferred<Record<string, never>>();
    const scanDecks = vi
      .fn<EditorSessionServices["scanDecks"]>()
      .mockResolvedValueOnce({ decks: [primaryDeck, secondaryDeck] })
      .mockResolvedValueOnce({ decks: [primaryDeck] });
    const services = createServices({
      scanDecks,
      appendItem: vi.fn(async () => appendDeferred.promise),
    });
    const actor = startSession({ mode: "create" }, services);

    try {
      await waitForSnapshot(actor, (snapshot) => snapshot.matches("ready"));

      actor.send({ type: "SET_FRONT_CONTENT", content: "question" });
      actor.send({ type: "SET_BACK_CONTENT", content: "answer" });
      actor.send({ type: "SUBMIT" });
      await waitForSnapshot(actor, (snapshot) =>
        snapshot.matches({ ready: { operations: "submitting" } }),
      );

      actor.send({ type: "REFRESH_DECKS" });
      const refreshed = await waitForSnapshot(
        actor,
        (snapshot) =>
          snapshot.matches({ ready: { operations: "submitting" } }) &&
          snapshot.context.decks.length === 1,
      );
      expect(refreshed.context.decks).toEqual([primaryDeck]);

      appendDeferred.resolve({});
      await waitForSnapshot(actor, (snapshot) =>
        snapshot.matches({ ready: { operations: "idle" } }),
      );
    } finally {
      actor.stop();
    }
  });

  it("clears duplicate state when selected deck disappears on refresh", async () => {
    vi.useFakeTimers();
    const scanDecks = vi
      .fn<EditorSessionServices["scanDecks"]>()
      .mockResolvedValueOnce({ decks: [primaryDeck, secondaryDeck] })
      .mockResolvedValueOnce({ decks: [primaryDeck] });
    const services = createServices({
      scanDecks,
      checkDuplicates: vi.fn(async () => ({
        isDuplicate: true,
        matchingDeckPath: Option.some(secondaryDeck.absolutePath),
      })),
    });
    const actor = startSession({ mode: "create" }, services);

    try {
      await waitForSnapshot(actor, (snapshot) => snapshot.matches("ready"));

      actor.send({ type: "SET_DECK_PATH", deckPath: secondaryDeck.absolutePath });
      actor.send({ type: "SET_FRONT_CONTENT", content: "question" });
      actor.send({ type: "SET_BACK_CONTENT", content: "answer" });
      await vi.advanceTimersByTimeAsync(450);
      await waitForSnapshot(actor, (snapshot) => snapshot.context.isDuplicate);

      actor.send({ type: "REFRESH_DECKS" });
      const refreshed = await waitForSnapshot(
        actor,
        (snapshot) => snapshot.context.deckPath === null && !snapshot.context.isDuplicate,
      );
      expect(refreshed.context.duplicateDeckPath).toBeNull();
    } finally {
      actor.stop();
      vi.useRealTimers();
    }
  });

  it("boots in edit mode and splits QA content", async () => {
    const services = createServices({
      getItemForEdit: vi.fn(async () => ({
        content: "  prompt text  \n---\n  answer text  ",
        cardType: "qa" as const,
        cardIds: ["card-1", "card-2"],
      })),
    });
    const actor = startSession(
      { mode: "edit", deckPath: primaryDeck.absolutePath, cardId: "card-2" },
      services,
    );

    try {
      const ready = await waitForSnapshot(actor, (snapshot) => snapshot.matches("ready"));
      expect(ready.context.mode).toBe("edit");
      expect(ready.context.cardType).toBe("qa");
      expect(ready.context.frontContent).toBe("prompt text");
      expect(ready.context.backContent).toBe("answer text");
      expect(ready.context.editCardId).toBe("card-2");
      expect(ready.context.editCardIds).toEqual(["card-1", "card-2"]);
    } finally {
      actor.stop();
    }
  });

  it("submits edit mode and rotates editCardId to the new identity", async () => {
    const replaceItem = vi.fn(async () => ({
      cardIds: ["card-1-new", "card-2-new"],
    }));
    const services = createServices({
      getItemForEdit: vi.fn(async () => ({
        content: "prompt\n---\nanswer",
        cardType: "qa" as const,
        cardIds: ["card-1", "card-2"],
      })),
      replaceItem,
    });
    const actor = startSession(
      { mode: "edit", deckPath: primaryDeck.absolutePath, cardId: "card-2" },
      services,
    );

    try {
      await waitForSnapshot(actor, (snapshot) => snapshot.matches("ready"));

      actor.send({ type: "SET_FRONT_CONTENT", content: "updated prompt" });
      actor.send({ type: "SET_BACK_CONTENT", content: "updated answer" });
      actor.send({ type: "SUBMIT" });

      const saved = await waitForSnapshot(
        actor,
        (snapshot) =>
          snapshot.matches({ ready: { operations: "idle" } }) &&
          snapshot.context.editCardId === "card-2-new" &&
          snapshot.context.dirty === false,
      );
      expect(replaceItem).toHaveBeenCalledWith({
        deckPath: primaryDeck.absolutePath,
        cardId: "card-2",
        content: "updated prompt\n---\nupdated answer",
        cardType: "qa",
      });
      expect(saved.context.editCardIds).toEqual(["card-1-new", "card-2-new"]);
      expect(saved.context.frontContent).toBe("updated prompt");
      expect(saved.context.backContent).toBe("updated answer");
    } finally {
      actor.stop();
    }
  });

  it("surfaces initialize failures as machine errors", async () => {
    const services = createServices({
      getSettings: vi.fn(async () => {
        throw new Error("settings failed");
      }),
    });
    const actor = startSession({ mode: "create" }, services);

    try {
      const ready = await waitForSnapshot(actor, (snapshot) => snapshot.matches("ready"));
      expect(ready.context.loading).toBe(false);
      expect(ready.context.lastError).toContain("settings failed");
    } finally {
      actor.stop();
    }
  });
});
