import { skipToken, useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";
import type { ForgeSourceInput } from "@shared/rpc/schemas/forge";

export function useForgePreviewQuery(source: ForgeSourceInput | null) {
  const ipc = useIpc();

  return useQuery({
    queryKey: queryKeys.forgePreview(source),
    queryFn: source
      ? () =>
          runIpcEffect(
            ipc.client
              .ForgePreviewChunks({ source })
              .pipe(
                Effect.catchTag("RpcDefectError", (rpcDefect) =>
                  Effect.fail(toRpcDefectError(rpcDefect)),
                ),
              ),
          )
      : skipToken,
  });
}
