import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";

import { mapSettingsErrorToError } from "@shared/settings";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";

export type UsePromptModelOverrideMutationResult = {
  readonly saving: boolean;
  readonly error: string | null;
  readonly setPromptModelOverride: (promptId: string, modelKey: string | null) => void;
  readonly clearError: () => void;
};

export function usePromptModelOverrideMutation(): UsePromptModelOverrideMutationResult {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: (input: { promptId: string; modelKey: string | null }) =>
      runIpcEffect(
        ipc.client.SetPromptModelOverride(input).pipe(
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.fail(toRpcDefectError(rpcDefect)),
          ),
          Effect.mapError(mapSettingsErrorToError),
        ),
      ),
    onMutate: () => {
      setError(null);
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings, settings);
    },
    onError: (err) => {
      console.error("[settings] set prompt model override", err);
      setError(`Failed to update model override: ${err.message}`);
    },
  });

  const setPromptModelOverride = useCallback(
    (promptId: string, modelKey: string | null) => {
      mutate({ promptId, modelKey });
    },
    [mutate],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    saving: isPending,
    error,
    setPromptModelOverride,
    clearError,
  };
}
