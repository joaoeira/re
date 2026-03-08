import { skipToken, useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";
import { mapForgeGetCardClozeErrorToError } from "@shared/rpc/schemas/forge";
import type { DerivationParentRef, ForgeGetCardClozeResult } from "@shared/rpc/schemas/forge";

export function useForgeCardClozeQuery(source: DerivationParentRef | null) {
  const ipc = useIpc();

  return useQuery<ForgeGetCardClozeResult, Error>({
    queryKey:
      source !== null
        ? queryKeys.forgeCardCloze(source)
        : [...queryKeys.forgeCardClozePrefix, "skipped"],
    queryFn:
      source !== null
        ? () =>
            runIpcEffect(
              ipc.client.ForgeGetCardCloze({ source }).pipe(
                Effect.catchTag("RpcDefectError", (rpcDefect) =>
                  Effect.fail(toRpcDefectError(rpcDefect)),
                ),
                Effect.mapError(mapForgeGetCardClozeErrorToError),
              ),
            )
        : skipToken,
  });
}
