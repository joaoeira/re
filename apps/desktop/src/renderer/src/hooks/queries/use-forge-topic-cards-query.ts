import { skipToken, useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";
import type { ForgeGetTopicCardsResult } from "@shared/rpc/schemas/forge";

type UseForgeTopicCardsQueryOptions = {
  readonly refetchIntervalMs?: number | false;
};

export function useForgeTopicCardsQuery(
  sessionId: number | null,
  topicId: number | null,
  options: UseForgeTopicCardsQueryOptions = {},
) {
  const ipc = useIpc();

  return useQuery<ForgeGetTopicCardsResult, Error>({
    queryKey: queryKeys.forgeTopicCards(sessionId, topicId),
    queryFn:
      sessionId !== null && topicId !== null
        ? () =>
            runIpcEffect(
              ipc.client
                .ForgeGetTopicCards({
                  sessionId,
                  topicId,
                })
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
