import { skipToken, useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";

export function useForgePreviewQuery(sourceFilePath: string | null) {
  const ipc = useIpc();

  return useQuery({
    queryKey: queryKeys.forgePreview(sourceFilePath),
    queryFn: sourceFilePath
      ? () =>
          runIpcEffect(
            ipc.client.ForgePreviewChunks({ sourceFilePath }).pipe(
              Effect.catchTag("RpcDefectError", (rpcDefect) =>
                Effect.fail(toRpcDefectError(rpcDefect)),
              ),
            ),
          )
      : skipToken,
  });
}
