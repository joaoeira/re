import { skipToken, useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";
import type { ForgeGetCardPermutationsResult } from "@shared/rpc/schemas/forge";

export function useForgeCardPermutationsQuery(sourceCardId: number | null) {
  const ipc = useIpc();

  return useQuery<ForgeGetCardPermutationsResult, Error>({
    queryKey: queryKeys.forgeCardPermutations(sourceCardId),
    queryFn: sourceCardId !== null
      ? () =>
          runIpcEffect(
            ipc.client.ForgeGetCardPermutations({ sourceCardId }).pipe(
              Effect.catchTag("RpcDefectError", (rpcDefect) =>
                Effect.fail(toRpcDefectError(rpcDefect)),
              ),
            ),
          )
      : skipToken,
  });
}
