import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";
import type {
  ForgeGenerateCardClozeInput,
  ForgeGenerateCardClozeResult,
  ForgeGenerateCardPermutationsInput,
  ForgeGenerateCardPermutationsResult,
  ForgeUpdateCardInput,
  ForgeUpdateCardResult,
  ForgeUpdatePermutationInput,
  ForgeUpdatePermutationResult,
} from "@shared/rpc/schemas/forge";

export const forgeCardsMutationKeys = {
  generatePermutations: ["forgeGenerateCardPermutations"] as const,
  generateCloze: ["forgeGenerateCardCloze"] as const,
  updateCard: ["forgeUpdateCard"] as const,
  updatePermutation: ["forgeUpdatePermutation"] as const,
};

export function useForgeGeneratePermutationsMutation() {
  const ipc = useIpc();
  const queryClient = useQueryClient();

  return useMutation<
    ForgeGenerateCardPermutationsResult,
    Error,
    ForgeGenerateCardPermutationsInput
  >({
    mutationKey: forgeCardsMutationKeys.generatePermutations,
    mutationFn: async (input) => {
      const result = await runIpcEffect(
        ipc.client
          .ForgeGenerateCardPermutations(input)
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      );
      queryClient.setQueryData(queryKeys.forgeCardPermutations(input.sourceCardId), () => result);
      return result;
    },
  });
}

export function useForgeGenerateClozeMutation() {
  const ipc = useIpc();
  const queryClient = useQueryClient();

  return useMutation<ForgeGenerateCardClozeResult, Error, ForgeGenerateCardClozeInput>({
    mutationKey: forgeCardsMutationKeys.generateCloze,
    mutationFn: async (input) => {
      const result = await runIpcEffect(
        ipc.client
          .ForgeGenerateCardCloze(input)
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      );
      queryClient.setQueryData(queryKeys.forgeCardCloze(input.sourceCardId), () => result);
      return result;
    },
  });
}

export function useForgeUpdateCardMutation() {
  const ipc = useIpc();

  return useMutation<ForgeUpdateCardResult, Error, ForgeUpdateCardInput>({
    mutationKey: forgeCardsMutationKeys.updateCard,
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

export function useForgeUpdatePermutationMutation() {
  const ipc = useIpc();

  return useMutation<ForgeUpdatePermutationResult, Error, ForgeUpdatePermutationInput>({
    mutationKey: forgeCardsMutationKeys.updatePermutation,
    mutationFn: (input) =>
      runIpcEffect(
        ipc.client
          .ForgeUpdatePermutation(input)
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      ),
  });
}
