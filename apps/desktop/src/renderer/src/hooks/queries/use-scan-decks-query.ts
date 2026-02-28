import { skipToken, useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { mapScanDecksErrorToError } from "@re/workspace";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";

export function useScanDecksQuery(rootPath: string | null) {
  const ipc = useIpc();

  return useQuery({
    queryKey: queryKeys.scanDecks(rootPath),
    queryFn: rootPath
      ? () =>
          runIpcEffect(
            ipc.client.ScanDecks({ rootPath }).pipe(
              Effect.catchTag("RpcDefectError", (rpcDefect) =>
                Effect.fail(toRpcDefectError(rpcDefect)),
              ),
              Effect.mapError(mapScanDecksErrorToError),
            ),
          )
      : skipToken,
  });
}
