import { CreateCardsPromptSpec } from "./create-cards";
import { CreateSynthesisCardsPromptSpec } from "./create-synthesis-cards";
import { GenerateClozePromptSpec } from "./generate-cloze";
import { GenerateExpansionsPromptSpec } from "./generate-expansions";
import { GeneratePermutationsPromptSpec } from "./generate-permutations";
import { GetTopicsPromptSpec } from "./get-topics";
import { GetSynthesisTopicsPromptSpec } from "./get-synthesis-topics";

export interface PromptSpecIdentity {
  readonly promptId: string;
  readonly version: string;
}

export type AnyPromptSpec = PromptSpecIdentity;

export interface ForgePromptRegistryData<Spec extends PromptSpecIdentity = PromptSpecIdentity> {
  readonly all: ReadonlyArray<Spec>;
  readonly byPromptId: ReadonlyMap<string, Spec>;
  readonly byPromptKey: ReadonlyMap<string, Spec>;
}

export const createForgePromptRegistry = <Spec extends PromptSpecIdentity>(
  specs: ReadonlyArray<Spec>,
): ForgePromptRegistryData<Spec> => {
  const byPromptId = new Map<string, Spec>();
  const byPromptKey = new Map<string, Spec>();

  for (const spec of specs) {
    const promptKey = `${spec.promptId}@${spec.version}`;

    if (byPromptKey.has(promptKey)) {
      throw new Error(`Duplicate Forge prompt key detected: ${promptKey}`);
    }

    if (byPromptId.has(spec.promptId)) {
      throw new Error(`Duplicate Forge promptId detected: ${spec.promptId}`);
    }

    byPromptId.set(spec.promptId, spec);
    byPromptKey.set(promptKey, spec);
  }

  return {
    all: specs,
    byPromptId,
    byPromptKey,
  };
};

export const ForgePromptRegistry = createForgePromptRegistry([
  GetTopicsPromptSpec,
  GetSynthesisTopicsPromptSpec,
  CreateCardsPromptSpec,
  CreateSynthesisCardsPromptSpec,
  GenerateExpansionsPromptSpec,
  GeneratePermutationsPromptSpec,
  GenerateClozePromptSpec,
]);
