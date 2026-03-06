import { skipToken, useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";
import { toReviewAssistantCardKey, type ReviewAssistantCardRef } from "@/lib/review-assistant";
import type { ReviewAssistantSourceCardResult } from "@shared/rpc/schemas/review";

export function useReviewAssistantSourceCardQuery(card: ReviewAssistantCardRef | null) {
  const ipc = useIpc();
  const cardKey = toReviewAssistantCardKey(card);

  return useQuery<ReviewAssistantSourceCardResult, Error>({
    queryKey: queryKeys.reviewAssistantSourceCard(cardKey),
    queryFn:
      card !== null
        ? () =>
            runIpcEffect(
              ipc.client
                .GetReviewAssistantSourceCard(card)
                .pipe(
                  Effect.catchTag("RpcDefectError", (rpcDefect) =>
                    Effect.fail(toRpcDefectError(rpcDefect)),
                  ),
                ),
            )
        : skipToken,
  });
}
