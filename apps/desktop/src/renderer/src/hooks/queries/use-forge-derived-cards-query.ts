import { skipToken, useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";
import { mapForgeGetDerivedCardsErrorToError } from "@shared/rpc/schemas/forge";
import type {
  DerivationKind,
  DerivationParentRef,
  ForgeGetDerivedCardsResult,
} from "@shared/rpc/schemas/forge";

export function useForgeDerivedCardsQuery(
  rootCardId: number | null,
  parent: DerivationParentRef | null,
  kind: DerivationKind,
) {
  const ipc = useIpc();

  return useQuery<ForgeGetDerivedCardsResult, Error>({
    queryKey:
      rootCardId !== null && parent !== null
        ? queryKeys.forgeDerivedCards(rootCardId, parent, kind)
        : [...queryKeys.forgeDerivedCardsPrefix, "skipped", kind],
    queryFn:
      rootCardId !== null && parent !== null
        ? () =>
            runIpcEffect(
              ipc.client.ForgeGetDerivedCards({ parent, kind }).pipe(
                Effect.catchTag("RpcDefectError", (rpcDefect) =>
                  Effect.fail(toRpcDefectError(rpcDefect)),
                ),
                Effect.mapError(mapForgeGetDerivedCardsErrorToError),
              ),
            )
        : skipToken,
  });
}
