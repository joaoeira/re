import { createStore } from "@xstate/store";
import type { SnapshotWorkspaceResult } from "@re/workspace";

export const workspaceStore = createStore({
  context: {
    status: "idle" as "idle" | "loading" | "ready" | "error",
    snapshotResult: null as SnapshotWorkspaceResult | null,
    error: null as string | null,
  },
  on: {
    setLoading: (context) => ({
      ...context,
      status: "loading" as const,
      error: null,
    }),
    setSnapshot: (context, event: { snapshot: SnapshotWorkspaceResult | null }) => ({
      ...context,
      status: "ready" as const,
      snapshotResult: event.snapshot,
      error: null,
    }),
    setError: (context, event: { error: string }) => ({
      ...context,
      status: "error" as const,
      snapshotResult: null,
      error: event.error,
    }),
  },
});
