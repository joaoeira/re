import { useMutation } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";

export type AppendItemInput = {
  readonly deckPath: string;
  readonly content: string;
  readonly cardType: "qa" | "cloze";
};

export type AppendItemResult = {
  readonly cardIds: readonly string[];
};

export function useAppendItemMutation() {
  const ipc = useIpc();

  return useMutation<AppendItemResult, Error, AppendItemInput>({
    mutationKey: ["appendItem"],
    mutationFn: (input) =>
      runIpcEffect(
        ipc.client
          .AppendItem(input)
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      ),
  });
}
