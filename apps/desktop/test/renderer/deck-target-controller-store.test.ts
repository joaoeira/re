import { describe, expect, it } from "vitest";

import {
  createDeckTargetControllerStore,
  type DeckTargetControllerCommand,
} from "@/components/forge/cards/deck-target-controller-store";

const getPendingCommands = (store: ReturnType<typeof createDeckTargetControllerStore>) =>
  store.getSnapshot().context.pendingCommands;

const getPersistCommands = (store: ReturnType<typeof createDeckTargetControllerStore>) =>
  getPendingCommands(store).filter(
    (
      command,
    ): command is Extract<DeckTargetControllerCommand, { type: "persistSessionDeckPath" }> =>
      command.type === "persistSessionDeckPath",
  );

describe("deck-target-controller-store", () => {
  it("auto-selects the first deck once per scope", () => {
    const store = createDeckTargetControllerStore();

    store.send({
      type: "syncFromView",
      sessionId: 1,
      scopeKey: "1:/workspace",
      targetDeckPath: null,
      deckPaths: ["/workspace/decks/alpha.md", "/workspace/decks/beta.md"],
      decksQuerySuccess: true,
      decksQueryFetching: false,
    });

    expect(getPendingCommands(store)).toEqual([
      { type: "setTargetDeckPath", deckPath: "/workspace/decks/alpha.md" },
    ]);

    store.send({ type: "commandsFlushed" });

    store.send({
      type: "syncFromView",
      sessionId: 1,
      scopeKey: "1:/workspace",
      targetDeckPath: null,
      deckPaths: ["/workspace/decks/alpha.md", "/workspace/decks/beta.md"],
      decksQuerySuccess: true,
      decksQueryFetching: false,
    });

    expect(getPendingCommands(store)).toEqual([]);
  });

  it("clears missing target and blocks silent fallback in that scope", () => {
    const store = createDeckTargetControllerStore();

    store.send({
      type: "syncFromView",
      sessionId: 2,
      scopeKey: "2:/workspace",
      targetDeckPath: "/workspace/decks/missing.md",
      deckPaths: ["/workspace/decks/alpha.md"],
      decksQuerySuccess: true,
      decksQueryFetching: false,
    });

    expect(getPendingCommands(store)).toEqual([{ type: "setTargetDeckPath", deckPath: null }]);

    store.send({ type: "commandsFlushed" });
    store.send({
      type: "syncFromView",
      sessionId: 2,
      scopeKey: "2:/workspace",
      targetDeckPath: null,
      deckPaths: ["/workspace/decks/alpha.md"],
      decksQuerySuccess: true,
      decksQueryFetching: false,
    });

    const commands = getPendingCommands(store);
    expect(
      commands.some(
        (command) =>
          command.type === "setTargetDeckPath" && command.deckPath === "/workspace/decks/alpha.md",
      ),
    ).toBe(false);
    expect(
      commands.some(
        (command) =>
          command.type === "persistSessionDeckPath" &&
          command.deckPath === null &&
          command.sessionId === 2,
      ),
    ).toBe(true);
  });

  it("deduplicates persist commands while one is in-flight", () => {
    const store = createDeckTargetControllerStore();

    store.send({
      type: "syncFromView",
      sessionId: 3,
      scopeKey: "3:/workspace",
      targetDeckPath: null,
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });
    store.send({ type: "commandsFlushed" });

    store.send({
      type: "syncFromView",
      sessionId: 3,
      scopeKey: "3:/workspace",
      targetDeckPath: "/workspace/decks/alpha.md",
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });
    store.send({
      type: "syncFromView",
      sessionId: 3,
      scopeKey: "3:/workspace",
      targetDeckPath: "/workspace/decks/alpha.md",
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });

    const persistCommands = getPersistCommands(store);
    expect(persistCommands).toHaveLength(1);
    expect(persistCommands[0]?.sessionId).toBe(3);
    expect(persistCommands[0]?.deckPath).toBe("/workspace/decks/alpha.md");

    store.send({ type: "commandsFlushed" });
    store.send({
      type: "syncFromView",
      sessionId: 3,
      scopeKey: "3:/workspace",
      targetDeckPath: "/workspace/decks/alpha.md",
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });

    expect(getPendingCommands(store)).toEqual([]);
  });

  it("allows retry after persist failure", () => {
    const store = createDeckTargetControllerStore();

    store.send({
      type: "syncFromView",
      sessionId: 4,
      scopeKey: "4:/workspace",
      targetDeckPath: null,
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });
    store.send({ type: "commandsFlushed" });

    store.send({
      type: "syncFromView",
      sessionId: 4,
      scopeKey: "4:/workspace",
      targetDeckPath: "/workspace/decks/beta.md",
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });
    const firstPersistCommand = getPersistCommands(store)[0];
    if (!firstPersistCommand) {
      throw new Error("Expected first persist command.");
    }
    store.send({ type: "commandsFlushed" });

    store.send({
      type: "persistFailed",
      requestId: firstPersistCommand.requestId,
    });

    store.send({
      type: "syncFromView",
      sessionId: 4,
      scopeKey: "4:/workspace",
      targetDeckPath: "/workspace/decks/beta.md",
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });

    const retryPersistCommand = getPersistCommands(store)[0];
    if (!retryPersistCommand) {
      throw new Error("Expected retry persist command.");
    }
    expect(retryPersistCommand.requestId).not.toBe(firstPersistCommand.requestId);
    expect(retryPersistCommand.sessionId).toBe(4);
    expect(retryPersistCommand.deckPath).toBe("/workspace/decks/beta.md");
  });

  it("advances observed baseline on persist success and avoids re-persisting same value", () => {
    const store = createDeckTargetControllerStore();

    store.send({
      type: "syncFromView",
      sessionId: 5,
      scopeKey: "5:/workspace",
      targetDeckPath: null,
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });

    store.send({
      type: "syncFromView",
      sessionId: 5,
      scopeKey: "5:/workspace",
      targetDeckPath: "/workspace/decks/alpha.md",
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });

    const persistCommand = getPersistCommands(store)[0];
    if (!persistCommand) {
      throw new Error("Expected persist command.");
    }
    store.send({ type: "commandsFlushed" });
    store.send({ type: "persistSucceeded", requestId: persistCommand.requestId });

    store.send({
      type: "syncFromView",
      sessionId: 5,
      scopeKey: "5:/workspace",
      targetDeckPath: "/workspace/decks/alpha.md",
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });

    expect(getPendingCommands(store)).toEqual([]);
  });

  it("keeps baseline aligned in superseded A->B->C persist race", () => {
    const store = createDeckTargetControllerStore();

    store.send({
      type: "syncFromView",
      sessionId: 6,
      scopeKey: "6:/workspace",
      targetDeckPath: "A",
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });
    store.send({ type: "commandsFlushed" });

    store.send({
      type: "syncFromView",
      sessionId: 6,
      scopeKey: "6:/workspace",
      targetDeckPath: "B",
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });
    const persistB = getPersistCommands(store)[0];
    if (!persistB) throw new Error("Expected persist B.");
    store.send({ type: "commandsFlushed" });

    store.send({
      type: "syncFromView",
      sessionId: 6,
      scopeKey: "6:/workspace",
      targetDeckPath: "C",
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });
    const persistC = getPersistCommands(store)[0];
    if (!persistC) throw new Error("Expected persist C.");
    store.send({ type: "commandsFlushed" });

    store.send({ type: "persistSucceeded", requestId: persistB.requestId });
    store.send({ type: "persistFailed", requestId: persistC.requestId });

    store.send({
      type: "syncFromView",
      sessionId: 6,
      scopeKey: "6:/workspace",
      targetDeckPath: "A",
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });

    const persistToA = getPersistCommands(store)[0];
    if (!persistToA) throw new Error("Expected persist to A.");
    expect(persistToA.deckPath).toBe("A");
    expect(persistToA.sessionId).toBe(6);
  });

  it("keeps only the latest setTargetDeckPath command", () => {
    const store = createDeckTargetControllerStore();

    store.send({
      type: "createDeckSucceeded",
      deckPath: "/workspace/decks/new.md",
    });
    store.send({
      type: "syncFromView",
      sessionId: 7,
      scopeKey: "7:/workspace",
      targetDeckPath: "/workspace/decks/missing.md",
      deckPaths: [],
      decksQuerySuccess: true,
      decksQueryFetching: false,
    });

    const setTargetCommands = getPendingCommands(store).filter(
      (command): command is Extract<typeof command, { type: "setTargetDeckPath" }> =>
        command.type === "setTargetDeckPath",
    );
    expect(setTargetCommands).toEqual([{ type: "setTargetDeckPath", deckPath: null }]);
  });

  it("clears pending created deck after created target appears in deck list", () => {
    const store = createDeckTargetControllerStore();

    store.send({
      type: "createDeckSucceeded",
      deckPath: "/workspace/decks/new.md",
    });

    store.send({
      type: "syncFromView",
      sessionId: 8,
      scopeKey: "8:/workspace",
      targetDeckPath: "/workspace/decks/new.md",
      deckPaths: [],
      decksQuerySuccess: true,
      decksQueryFetching: false,
    });
    expect(store.getSnapshot().context.pendingCreatedDeckPath).toBe("/workspace/decks/new.md");

    store.send({
      type: "syncFromView",
      sessionId: 8,
      scopeKey: "8:/workspace",
      targetDeckPath: "/workspace/decks/new.md",
      deckPaths: ["/workspace/decks/new.md"],
      decksQuerySuccess: true,
      decksQueryFetching: false,
    });
    expect(store.getSnapshot().context.pendingCreatedDeckPath).toBeNull();
  });

  it("tracks concurrent session persists independently", () => {
    const store = createDeckTargetControllerStore();

    store.send({
      type: "syncFromView",
      sessionId: 11,
      scopeKey: "11:/workspace",
      targetDeckPath: null,
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });
    store.send({
      type: "syncFromView",
      sessionId: 12,
      scopeKey: "12:/workspace",
      targetDeckPath: null,
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });
    store.send({ type: "commandsFlushed" });

    store.send({
      type: "syncFromView",
      sessionId: 11,
      scopeKey: "11:/workspace",
      targetDeckPath: "/workspace/decks/a.md",
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });
    store.send({
      type: "syncFromView",
      sessionId: 12,
      scopeKey: "12:/workspace",
      targetDeckPath: "/workspace/decks/b.md",
      deckPaths: [],
      decksQuerySuccess: false,
      decksQueryFetching: false,
    });

    const persistCommands = getPersistCommands(store);
    expect(
      persistCommands.some(
        (command) => command.sessionId === 11 && command.deckPath === "/workspace/decks/a.md",
      ),
    ).toBe(true);
    expect(
      persistCommands.some(
        (command) => command.sessionId === 12 && command.deckPath === "/workspace/decks/b.md",
      ),
    ).toBe(true);
  });

  it("supports idempotent commandsFlushed and reset", () => {
    const store = createDeckTargetControllerStore();

    store.send({ type: "commandsFlushed" });
    expect(getPendingCommands(store)).toEqual([]);

    store.send({
      type: "syncFromView",
      sessionId: 9,
      scopeKey: "9:/workspace",
      targetDeckPath: null,
      deckPaths: ["/workspace/decks/alpha.md"],
      decksQuerySuccess: true,
      decksQueryFetching: false,
    });
    expect(getPendingCommands(store).length).toBeGreaterThan(0);

    store.send({ type: "reset" });
    const snapshot = store.getSnapshot().context;
    expect(snapshot.pendingCommands).toEqual([]);
    expect(snapshot.pendingCreatedDeckPath).toBeNull();
    expect(snapshot.autoResolvedScopeKeys.size).toBe(0);
    expect(snapshot.observedDeckPathBySessionId.size).toBe(0);
    expect(snapshot.nextPersistRequestId).toBe(1);
    expect(snapshot.inFlightPersistRequestsById.size).toBe(0);
    expect(snapshot.inFlightPersistDeckPathsBySessionId.size).toBe(0);
  });
});
