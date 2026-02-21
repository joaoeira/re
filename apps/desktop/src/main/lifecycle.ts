import { createNoopReviewAnalyticsRepository, type ReviewAnalyticsRepository } from "@main/analytics";
import type { SqliteReviewAnalyticsRuntimeBundle } from "@main/analytics/sqlite-repository";

export interface AnalyticsInitializationResult {
  readonly repository: ReviewAnalyticsRepository;
  readonly runtime: SqliteReviewAnalyticsRuntimeBundle["runtime"] | null;
  readonly startupFailed: boolean;
}

export interface SingleFlightTask {
  readonly run: () => Promise<void>;
}

export const createSingleFlightTask = (
  task: () => Promise<void>,
): SingleFlightTask => {
  let inFlight = false;

  return {
    run: async () => {
      if (inFlight) {
        return;
      }

      inFlight = true;
      try {
        await task();
      } finally {
        inFlight = false;
      }
    },
  };
};

export const initializeAnalyticsRuntime = async (
  bundle: SqliteReviewAnalyticsRuntimeBundle,
): Promise<AnalyticsInitializationResult> => {
  try {
    await bundle.runtime.runPromise(bundle.startupEffect);
    return {
      repository: bundle.repository,
      runtime: bundle.runtime,
      startupFailed: false,
    };
  } catch {
    try {
      await bundle.runtime.dispose();
    } catch {
      // Best effort cleanup; fallback still proceeds.
    }

    return {
      repository: createNoopReviewAnalyticsRepository(),
      runtime: null,
      startupFailed: true,
    };
  }
};

export interface QuitPipelineEvent {
  preventDefault: () => void;
}

export interface QuitPipelineDeps {
  readonly closeEditorWindow: () => Promise<void>;
  readonly stopReplayTimer: () => void;
  readonly disposeWatcherAndIpc: () => void;
  readonly disposeAnalytics: () => Promise<void>;
  readonly requestQuit: () => void;
  readonly onError: (error: unknown) => void;
}

export interface UnifiedQuitPipeline {
  readonly handleBeforeQuit: (event: QuitPipelineEvent) => void;
  readonly markShutdownComplete: () => void;
}

export const createUnifiedQuitPipeline = (deps: QuitPipelineDeps): UnifiedQuitPipeline => {
  let isShuttingDown = false;
  let shutdownComplete = false;

  const run = async (): Promise<void> => {
    const runStep = async (step: () => Promise<void> | void): Promise<void> => {
      try {
        await step();
      } catch (error) {
        deps.onError(error);
      }
    };

    try {
      await runStep(deps.closeEditorWindow);
      await runStep(async () => {
        deps.stopReplayTimer();
      });
      await runStep(async () => {
        deps.disposeWatcherAndIpc();
      });
      await runStep(deps.disposeAnalytics);
    } finally {
      shutdownComplete = true;
      isShuttingDown = false;
      deps.requestQuit();
    }
  };

  return {
    handleBeforeQuit: (event) => {
      if (shutdownComplete) {
        return;
      }

      event.preventDefault();

      if (isShuttingDown) {
        return;
      }

      isShuttingDown = true;
      void run();
    },
    markShutdownComplete: () => {
      shutdownComplete = true;
    },
  };
};
