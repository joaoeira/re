import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { createNoopReviewAnalyticsRepository } from "@main/analytics";
import {
  createSingleFlightTask,
  createUnifiedQuitPipeline,
  initializeAnalyticsRuntime,
} from "@main/lifecycle";
import type { SqliteReviewAnalyticsRuntimeBundle } from "@main/analytics/sqlite-repository";

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flushAsync = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("main lifecycle helpers", () => {
  it("keeps analytics enabled when eager startup probe succeeds", async () => {
    const repository = { ...createNoopReviewAnalyticsRepository(), enabled: true };
    const runtime = {
      runPromise: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };

    const bundle = {
      runtime,
      startupEffect: Effect.void,
      repository,
    } as unknown as SqliteReviewAnalyticsRuntimeBundle;

    const initialized = await initializeAnalyticsRuntime(bundle);
    expect(initialized.startupFailed).toBe(false);
    expect(initialized.repository.enabled).toBe(true);
    expect(initialized.runtime).toBe(runtime);
    expect(runtime.dispose).not.toHaveBeenCalled();
  });

  it("falls back to no-op analytics when eager startup probe fails", async () => {
    const runtime = {
      runPromise: vi.fn().mockRejectedValue(new Error("migration failed")),
      dispose: vi.fn().mockResolvedValue(undefined),
    };

    const bundle = {
      runtime,
      startupEffect: Effect.void,
      repository: { ...createNoopReviewAnalyticsRepository(), enabled: true },
    } as unknown as SqliteReviewAnalyticsRuntimeBundle;

    const initialized = await initializeAnalyticsRuntime(bundle);
    expect(initialized.startupFailed).toBe(true);
    expect(initialized.repository.enabled).toBe(false);
    expect(initialized.runtime).toBeNull();
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });

  it("runs unified before-quit pipeline once and awaits async disposal before quit", async () => {
    const sequence: string[] = [];
    const disposeDeferred = createDeferred<void>();
    const onError = vi.fn();

    const pipeline = createUnifiedQuitPipeline({
      closeEditorWindow: async () => {
        sequence.push("closeEditor");
      },
      stopReplayTimer: () => {
        sequence.push("stopReplay");
      },
      disposeWatcherAndIpc: () => {
        sequence.push("disposeIpcWatcher");
      },
      disposeAnalytics: async () => {
        sequence.push("disposeAnalytics:start");
        await disposeDeferred.promise;
        sequence.push("disposeAnalytics:done");
      },
      requestQuit: () => {
        sequence.push("requestQuit");
      },
      onError,
    });

    const event = { preventDefault: vi.fn() };
    pipeline.handleBeforeQuit(event);
    pipeline.handleBeforeQuit(event);

    await flushAsync();

    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(sequence).toEqual([
      "closeEditor",
      "stopReplay",
      "disposeIpcWatcher",
      "disposeAnalytics:start",
    ]);

    disposeDeferred.resolve();
    await flushAsync();

    expect(sequence).toEqual([
      "closeEditor",
      "stopReplay",
      "disposeIpcWatcher",
      "disposeAnalytics:start",
      "disposeAnalytics:done",
      "requestQuit",
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("continues cleanup steps even when an early quit step throws", async () => {
    const sequence: string[] = [];
    const onError = vi.fn();

    const pipeline = createUnifiedQuitPipeline({
      closeEditorWindow: async () => {
        sequence.push("closeEditor");
        throw new Error("close failed");
      },
      stopReplayTimer: () => {
        sequence.push("stopReplay");
      },
      disposeWatcherAndIpc: () => {
        sequence.push("disposeIpcWatcher");
      },
      disposeAnalytics: async () => {
        sequence.push("disposeAnalytics");
      },
      requestQuit: () => {
        sequence.push("requestQuit");
      },
      onError,
    });

    pipeline.handleBeforeQuit({ preventDefault: vi.fn() });
    await flushAsync();

    expect(sequence).toEqual([
      "closeEditor",
      "stopReplay",
      "disposeIpcWatcher",
      "disposeAnalytics",
      "requestQuit",
    ]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent runs in single-flight task", async () => {
    const gate = createDeferred<void>();
    const steps: string[] = [];
    const task = createSingleFlightTask(async () => {
      steps.push("run:start");
      await gate.promise;
      steps.push("run:end");
    });

    const first = task.run();
    const second = task.run();
    await Promise.resolve();

    expect(steps).toEqual(["run:start"]);

    gate.resolve();
    await first;
    await second;
    expect(steps).toEqual(["run:start", "run:end"]);
  });
});
