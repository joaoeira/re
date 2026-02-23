import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  AppEventPublisherBridgeLive,
  AppEventPublisherService,
  DuplicateIndexInvalidationBridgeLive,
  DuplicateIndexInvalidationService,
  EditorWindowManagerBridgeLive,
  EditorWindowManagerService,
  WorkspaceWatcherControlBridgeLive,
  WorkspaceWatcherControlService,
} from "@main/di";
import type { WorkspaceWatcher } from "@main/watcher/workspace-watcher";
import { CardEdited } from "@shared/rpc/contracts";

describe("startup bridge services", () => {
  it("keeps publish calls safe before bind and forwards after bind", async () => {
    const appEventPublisher = Effect.runSync(
      Effect.gen(function* () {
        return yield* AppEventPublisherService;
      }).pipe(Effect.provide(AppEventPublisherBridgeLive)),
    );

    await Effect.runPromise(appEventPublisher.publish(CardEdited, { deckPath: "a", cardId: "b" }));

    const publishedEvents: Array<{ name: string; payload: unknown }> = [];
    const publishSpy = vi.fn(
      (event: typeof CardEdited, payload: { deckPath: string; cardId: string }) =>
        Effect.sync(() => {
          publishedEvents.push({ name: event.name, payload });
        }),
    );

    appEventPublisher.bind(publishSpy as typeof appEventPublisher.publish);
    await Effect.runPromise(appEventPublisher.publish(CardEdited, { deckPath: "a", cardId: "b" }));

    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishedEvents).toEqual([
      { name: "CardEdited", payload: { deckPath: "a", cardId: "b" } },
    ]);
  });

  it("keeps watcher controls safe before bind and forwards after bind", () => {
    const watcherControl = Effect.runSync(
      Effect.gen(function* () {
        return yield* WorkspaceWatcherControlService;
      }).pipe(Effect.provide(WorkspaceWatcherControlBridgeLive)),
    );

    watcherControl.start("/tmp/unbound");
    watcherControl.stop();

    const watcher: WorkspaceWatcher = {
      start: vi.fn(),
      stop: vi.fn(),
    };

    watcherControl.bind(watcher);
    watcherControl.start("/tmp/bound");
    watcherControl.stop();

    expect(watcher.start).toHaveBeenCalledWith("/tmp/bound");
    expect(watcher.stop).toHaveBeenCalledTimes(1);
  });

  it("invokes duplicate listeners only after registration", () => {
    const duplicateIndexInvalidation = Effect.runSync(
      Effect.gen(function* () {
        return yield* DuplicateIndexInvalidationService;
      }).pipe(Effect.provide(DuplicateIndexInvalidationBridgeLive)),
    );

    const listener = vi.fn();

    duplicateIndexInvalidation.markDuplicateIndexDirty();
    expect(listener).not.toHaveBeenCalled();

    duplicateIndexInvalidation.registerListener(listener);
    duplicateIndexInvalidation.markDuplicateIndexDirty();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps editor window calls safe before bind and forwards after bind", () => {
    const editorWindowManager = Effect.runSync(
      Effect.gen(function* () {
        return yield* EditorWindowManagerService;
      }).pipe(Effect.provide(EditorWindowManagerBridgeLive)),
    );

    editorWindowManager.openEditorWindow({ mode: "create" });

    const openEditorWindow = vi.fn();
    editorWindowManager.bindOpenEditorWindow(openEditorWindow);

    editorWindowManager.openEditorWindow({
      mode: "edit",
      deckPath: "/tmp/deck.md",
      cardId: "card-1",
    });

    expect(openEditorWindow).toHaveBeenCalledWith({
      mode: "edit",
      deckPath: "/tmp/deck.md",
      cardId: "card-1",
    });
  });
});
