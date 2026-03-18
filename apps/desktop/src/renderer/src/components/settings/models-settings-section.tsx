import { useDefaultModelMutation } from "@/hooks/mutations/use-default-model-mutation";
import { usePromptModelOverrideMutation } from "@/hooks/mutations/use-prompt-model-override-mutation";
import { useAiModelsQuery } from "@/hooks/queries/use-ai-models-query";
import { usePromptTasksQuery } from "@/hooks/queries/use-prompt-tasks-query";
import { useSettingsQuery } from "@/hooks/queries/use-settings-query";
import { ModelsSettings } from "./models-settings";
import { useSettingsPageActions } from "./settings-page-context";

export function ModelsSettingsSection() {
  const actions = useSettingsPageActions();
  const settingsQuery = useSettingsQuery();
  const aiModelsQuery = useAiModelsQuery();
  const promptTasksQuery = usePromptTasksQuery();
  const defaultModelMutation = useDefaultModelMutation();
  const overrideMutation = usePromptModelOverrideMutation();

  if (aiModelsQuery.isPending || settingsQuery.isPending) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
        Loading...
      </div>
    );
  }

  const modelsLoadError = aiModelsQuery.error
    ? `Failed to load models: ${aiModelsQuery.error.message}`
    : null;

  if (modelsLoadError) {
    return (
      <div className="flex items-center justify-between border border-destructive/30 bg-destructive/5 px-3 py-2">
        <p className="text-destructive text-xs">{modelsLoadError}</p>
        <button
          type="button"
          className="text-destructive/90 text-xs underline underline-offset-2"
          onClick={actions.reload}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <ModelsSettings
      models={aiModelsQuery.data?.models ?? []}
      defaultModelKey={settingsQuery.data?.ai.defaultModelKey ?? null}
      applicationDefaultModelKey={aiModelsQuery.data?.applicationDefaultModelKey ?? null}
      saving={defaultModelMutation.saving}
      error={defaultModelMutation.error}
      onDefaultModelChange={defaultModelMutation.setDefaultModelKey}
      promptTasks={promptTasksQuery.data?.tasks ?? []}
      promptTasksLoading={promptTasksQuery.isPending}
      promptModelOverrides={settingsQuery.data?.ai.promptModelOverrides ?? {}}
      overrideSaving={overrideMutation.saving}
      overrideError={overrideMutation.error}
      onOverrideChange={overrideMutation.setPromptModelOverride}
    />
  );
}
