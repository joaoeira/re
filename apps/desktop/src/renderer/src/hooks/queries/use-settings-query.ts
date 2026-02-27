import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { mapSettingsErrorToError } from "@shared/settings";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";

export function useSettingsQuery() {
  const ipc = useIpc();

  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () =>
      runIpcEffect(
        ipc.client.GetSettings().pipe(
          Effect.catchTag("RpcDefectError", (rpcDefect) => Effect.fail(toRpcDefectError(rpcDefect))),
          Effect.mapError(mapSettingsErrorToError),
        ),
      ),
  });
}
