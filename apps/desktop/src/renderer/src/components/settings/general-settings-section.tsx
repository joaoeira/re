import { GeneralSettings } from "./general-settings";
import { useSettingsPageActions, useSettingsPageState } from "./settings-page-context";

export function GeneralSettingsSection() {
  const { rootPath, rootPathSaving, rootPathError } = useSettingsPageState();
  const actions = useSettingsPageActions();

  return (
    <GeneralSettings
      rootPath={rootPath}
      saving={rootPathSaving}
      error={rootPathError}
      onSelectDirectory={actions.selectDirectory}
      onClearRootPath={actions.clearRootPath}
    />
  );
}
