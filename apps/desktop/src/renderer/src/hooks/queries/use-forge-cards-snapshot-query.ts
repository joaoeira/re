import { skipToken, useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";
import type { ForgeGetCardsSnapshotResult } from "@shared/rpc/schemas/forge";

type UseForgeCardsSnapshotQueryOptions = {
  readonly refetchIntervalMs?: number | false;
};

export function useForgeCardsSnapshotQuery(
  sessionId: number | null,
  options: UseForgeCardsSnapshotQueryOptions = {},
) {
  const ipc = useIpc();

  return useQuery<ForgeGetCardsSnapshotResult, Error>({
    queryKey: queryKeys.forgeCardsSnapshot(sessionId),
    queryFn:
      sessionId !== null
        ? () =>
            runIpcEffect(
              ipc.client
                .ForgeGetCardsSnapshot({ sessionId })
                .pipe(
                  Effect.catchTag("RpcDefectError", (rpcDefect) =>
                    Effect.fail(toRpcDefectError(rpcDefect)),
                  ),
                ),
            )
        : skipToken,
    refetchInterval: options.refetchIntervalMs ?? false,
  });
}
