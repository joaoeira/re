import { useMutation } from "@tanstack/react-query";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import type {
  ReviewGeneratePermutationsInput,
  ReviewGeneratePermutationsResult,
} from "@shared/rpc/schemas/review";

export const reviewAssistantMutationKeys = {
  generatePermutations: ["reviewGeneratePermutations"] as const,
};

export function useReviewGeneratePermutationsMutation() {
  const ipc = useIpc();

  return useMutation<ReviewGeneratePermutationsResult, Error, ReviewGeneratePermutationsInput>({
    mutationKey: reviewAssistantMutationKeys.generatePermutations,
    mutationFn: (input) =>
      runIpcEffect(
        ipc.client
          .ReviewGeneratePermutations(input)
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      ),
  });
}
