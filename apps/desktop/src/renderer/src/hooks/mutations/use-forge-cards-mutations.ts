import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";
import {
  sameDerivationParentRef,
  mapForgeGenerateCardClozeErrorToError,
  DerivationParentRef,
  mapForgeGenerateDerivedCardsErrorToError,
  type ForgeAddCardToDeckInput,
  type ForgeAddCardToDeckResult,
  type ForgeGenerateCardClozeInput,
  type ForgeGenerateCardClozeResult,
  type ForgeGenerateDerivedCardsInput,
  type ForgeGenerateDerivedCardsResult,
  type ForgeUpdateCardInput,
  type ForgeUpdateCardResult,
  type ForgeUpdateDerivationInput,
  type ForgeUpdateDerivationResult,
} from "@shared/rpc/schemas/forge";

export const formatQAContent = (question: string, answer: string): string =>
  `${question}\n---\n${answer}\n`;

export const forgeCardsMutationKeys = {
  generateDerivedCards: ["forgeGenerateDerivedCards"] as const,
  generateCloze: ["forgeGenerateCardCloze"] as const,
  updateCard: ["forgeUpdateCard"] as const,
  updateDerivation: ["forgeUpdateDerivation"] as const,
  addCardToDeck: ["forgeAddCardToDeck"] as const,
};

export type ForgeGenerateDerivedCardsMutationInput = ForgeGenerateDerivedCardsInput & {
  readonly rootCardId: number;
};

export const isForgeDerivationConfirmationResult = (
  result: ForgeGenerateDerivedCardsResult,
): result is Extract<ForgeGenerateDerivedCardsResult, { readonly confirmRequired: true }> =>
  "confirmRequired" in result && result.confirmRequired === true;

export { sameDerivationParentRef };

export function useForgeGenerateDerivedCardsMutation() {
  const ipc = useIpc();
  const queryClient = useQueryClient();

  return useMutation<
    ForgeGenerateDerivedCardsResult,
    Error,
    ForgeGenerateDerivedCardsMutationInput
  >({
    mutationKey: forgeCardsMutationKeys.generateDerivedCards,
    mutationFn: async ({ rootCardId: _rootCardId, ...input }) => {
      const result = await runIpcEffect(
        ipc.client.ForgeGenerateDerivedCards(input).pipe(
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.fail(toRpcDefectError(rpcDefect)),
          ),
          Effect.mapError(mapForgeGenerateDerivedCardsErrorToError),
        ),
      );
      return result;
    },
    onSuccess: (result, variables) => {
      if (!isForgeDerivationConfirmationResult(result)) {
        const currentQueryKey = queryKeys.forgeDerivedCards(
          variables.rootCardId,
          variables.parent,
          variables.kind,
        );
        queryClient.setQueryData(currentQueryKey, () => result);
        void queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0] === queryKeys.forgeDerivedCardsPrefix[0] &&
            query.queryKey[1] === variables.rootCardId &&
            !(
              sameDerivationParentRef(query.queryKey[2] as DerivationParentRef, variables.parent) &&
              query.queryKey[3] === variables.kind
            ),
        });
        if (variables.confirmed === true) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.forgeCardClozePrefix,
          });
        }
      }
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
        ipc.client.ForgeGenerateCardCloze(input).pipe(
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.fail(toRpcDefectError(rpcDefect)),
          ),
          Effect.mapError(mapForgeGenerateCardClozeErrorToError),
        ),
      );
      queryClient.setQueryData(queryKeys.forgeCardCloze(input.source), () => result);
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

export function useForgeUpdateDerivationMutation() {
  const ipc = useIpc();

  return useMutation<ForgeUpdateDerivationResult, Error, ForgeUpdateDerivationInput>({
    mutationKey: forgeCardsMutationKeys.updateDerivation,
    mutationFn: (input) =>
      runIpcEffect(
        ipc.client
          .ForgeUpdateDerivation(input)
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      ),
  });
}

export function useForgeAddCardToDeckMutation() {
  const ipc = useIpc();

  return useMutation<ForgeAddCardToDeckResult, Error, ForgeAddCardToDeckInput>({
    mutationKey: forgeCardsMutationKeys.addCardToDeck,
    mutationFn: (input) =>
      runIpcEffect(
        ipc.client
          .ForgeAddCardToDeck(input)
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      ),
  });
}
