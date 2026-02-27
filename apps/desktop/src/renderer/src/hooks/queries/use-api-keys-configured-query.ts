import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { mapSecretStoreErrorToError, type SecretKey } from "@shared/secrets";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";

export const SECRET_KEYS: readonly SecretKey[] = [
  "openai-api-key",
  "anthropic-api-key",
  "gemini-api-key",
] as const;

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
