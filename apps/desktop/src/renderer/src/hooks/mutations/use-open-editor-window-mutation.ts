import { useMutation } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";

export type OpenEditorWindowInput =
  | { mode: "create"; deckPath?: string }
  | { mode: "edit"; deckPath: string; cardId: string };

export function useOpenEditorWindowMutation() {
  const ipc = useIpc();

  return useMutation({
    mutationFn: (input: OpenEditorWindowInput) =>
      runIpcEffect(
        ipc.client.OpenEditorWindow(input).pipe(
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.fail(toRpcDefectError(rpcDefect)),
          ),
        ),
      ),
    onError: () => undefined,
  });
}
