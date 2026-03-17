import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";

import { mapSettingsErrorToError } from "@shared/settings";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";

export type UseDefaultModelMutationResult = {
  readonly saving: boolean;
  readonly error: string | null;
  readonly setDefaultModelKey: (modelKey: string | null) => void;
  readonly clearError: () => void;
};

export function useDefaultModelMutation(): UseDefaultModelMutationResult {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: (modelKey: string | null) =>
      runIpcEffect(
        ipc.client.SetDefaultModelKey({ modelKey }).pipe(
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
      console.error("[settings] set default model key", err);
      setError(`Failed to update default model: ${err.message}`);
    },
  });

  const setDefaultModelKey = useCallback(
    (modelKey: string | null) => {
      mutate(modelKey);
    },
    [mutate],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    saving: isPending,
    error,
    setDefaultModelKey,
    clearError,
  };
}
