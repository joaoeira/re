import { ModelsSettings } from "./models-settings";
import { useSettingsPageActions, useSettingsPageState } from "./settings-page-context";

export function ModelsSettingsSection() {
  const {
    defaultModelKey,
    defaultModelSaving,
    defaultModelError,
    aiModels,
    applicationDefaultModelKey,
    modelsLoading,
    modelsLoadError,
  } = useSettingsPageState();
  const actions = useSettingsPageActions();

  if (modelsLoading) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
        Loading...
      </div>
    );
  }

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
      models={aiModels}
      defaultModelKey={defaultModelKey}
      applicationDefaultModelKey={applicationDefaultModelKey}
      saving={defaultModelSaving}
      error={defaultModelError}
      onDefaultModelChange={actions.setDefaultModelKey}
    />
  );
}
