import { skipToken, useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";
import type { ForgeGetCardClozeResult } from "@shared/rpc/schemas/forge";

export function useForgeCardClozeQuery(sourceCardId: number | null) {
  const ipc = useIpc();

  return useQuery<ForgeGetCardClozeResult, Error>({
    queryKey: queryKeys.forgeCardCloze(sourceCardId),
    queryFn:
      sourceCardId !== null
        ? () =>
            runIpcEffect(
              ipc.client
                .ForgeGetCardCloze({ sourceCardId })
                .pipe(
                  Effect.catchTag("RpcDefectError", (rpcDefect) =>
                    Effect.fail(toRpcDefectError(rpcDefect)),
                  ),
                ),
            )
        : skipToken,
  });
}
