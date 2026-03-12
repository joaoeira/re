import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { mapSecretStoreErrorToError, SECRET_KEYS, type SecretKey } from "@shared/secrets";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";

export function useApiKeysConfiguredQuery() {
  const ipc = useIpc();

  return useQuery({
    queryKey: queryKeys.apiKeysConfigured,
    queryFn: async () => {
      const configuredEntries = await Promise.all(
        SECRET_KEYS.map(async (key) => {
          const result = await runIpcEffect(
            ipc.client.HasApiKey({ key }).pipe(
              Effect.catchTag("RpcDefectError", (rpcDefect) =>
                Effect.fail(toRpcDefectError(rpcDefect)),
              ),
              Effect.mapError(mapSecretStoreErrorToError),
            ),
          );
          return [key, result.configured] as const;
        }),
      );

      return Object.fromEntries(configuredEntries) as Record<SecretKey, boolean>;
    },
  });
}
