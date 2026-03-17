import { Context, Effect } from "effect";

import type { SettingsRepository } from "@main/settings/repository";
import { PromptModelResolutionFailed, type ResolvedAiModel } from "@shared/ai-models";
import { toSettingsErrorMessage } from "@shared/settings";

import { resolveModelFromCatalog, type AiModelCatalog } from "./model-catalog";

export type ModelResolutionSource = "prompt-override" | "user-default" | "catalog-default";

export interface ResolvedPromptModel {
  readonly model: ResolvedAiModel;
  readonly source: ModelResolutionSource;
}

export interface PromptModelResolver {
  readonly resolve: (
    promptId: string,
  ) => Effect.Effect<ResolvedPromptModel, PromptModelResolutionFailed>;
}

export const PromptModelResolver = Context.GenericTag<PromptModelResolver>(
  "@re/desktop/main/PromptModelResolver",
);

export interface MakePromptModelResolverOptions {
  readonly settingsRepository: SettingsRepository;
  readonly aiModelCatalog: AiModelCatalog;
}

export const makePromptModelResolver = ({
  settingsRepository,
  aiModelCatalog,
}: MakePromptModelResolverOptions): PromptModelResolver => ({
  resolve: (promptId) =>
    Effect.gen(function* () {
      const settings = yield* settingsRepository.getSettings().pipe(
        Effect.mapError(
          (error) =>
            new PromptModelResolutionFailed({
              promptId,
              message: `Unable to read settings for model resolution: ${toSettingsErrorMessage(error)}`,
            }),
        ),
      );
      const catalogDefaultKey = yield* aiModelCatalog.getApplicationDefaultModelKey();

      const candidates: Array<{ readonly key: string; readonly source: ModelResolutionSource }> =
        [];
      const promptOverrideKey = settings.ai.promptModelOverrides[promptId];

      if (promptOverrideKey !== undefined) {
        candidates.push({ key: promptOverrideKey, source: "prompt-override" });
      }

      if (settings.ai.defaultModelKey !== null) {
        candidates.push({ key: settings.ai.defaultModelKey, source: "user-default" });
      }

      candidates.push({ key: catalogDefaultKey, source: "catalog-default" });

      const skipped: Array<string> = [];

      for (const candidate of candidates) {
        const result = yield* resolveModelFromCatalog(aiModelCatalog, candidate.key, (key) => ({
          key,
        })).pipe(
          Effect.map((model) => ({ _tag: "resolved" as const, model })),
          Effect.catchAll((rejection) =>
            Effect.succeed({ _tag: "skipped" as const, key: rejection.key }),
          ),
        );

        if (result._tag === "skipped") {
          skipped.push(result.key);
          continue;
        }

        return {
          model: result.model,
          source: candidate.source,
        };
      }

      return yield* new PromptModelResolutionFailed({
        promptId,
        message:
          skipped.length > 0
            ? `All configured model candidates were skipped: ${skipped.join(", ")}`
            : "No model candidates are configured for this prompt.",
      });
    }),
});
