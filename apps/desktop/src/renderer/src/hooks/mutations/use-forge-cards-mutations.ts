import { useMutation } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import type {
  ForgeGenerateCardClozeInput,
  ForgeGenerateCardClozeResult,
  ForgeGenerateCardPermutationsInput,
  ForgeGenerateCardPermutationsResult,
  ForgeGenerateTopicCardsInput,
  ForgeGenerateTopicCardsResult,
  ForgeUpdateCardInput,
  ForgeUpdateCardResult,
} from "@shared/rpc/schemas/forge";

export function useForgeGenerateTopicCardsMutation() {
  const ipc = useIpc();

  return useMutation<ForgeGenerateTopicCardsResult, Error, ForgeGenerateTopicCardsInput>({
    mutationFn: (input) =>
      runIpcEffect(
        ipc.client
          .ForgeGenerateTopicCards(input)
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      ),
  });
}

export function useForgeGeneratePermutationsMutation() {
  const ipc = useIpc();

  return useMutation<
    ForgeGenerateCardPermutationsResult,
    Error,
    ForgeGenerateCardPermutationsInput
  >({
    mutationFn: (input) =>
      runIpcEffect(
        ipc.client
          .ForgeGenerateCardPermutations(input)
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      ),
  });
}

export function useForgeGenerateClozeMutation() {
  const ipc = useIpc();

  return useMutation<ForgeGenerateCardClozeResult, Error, ForgeGenerateCardClozeInput>({
    mutationFn: (input) =>
      runIpcEffect(
        ipc.client
          .ForgeGenerateCardCloze(input)
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      ),
  });
}

export function useForgeUpdateCardMutation() {
  const ipc = useIpc();

  return useMutation<ForgeUpdateCardResult, Error, ForgeUpdateCardInput>({
    mutationFn: (input) =>
      runIpcEffect(
        ipc.client
          .ForgeUpdateCard(input)
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      ),
  });
}
