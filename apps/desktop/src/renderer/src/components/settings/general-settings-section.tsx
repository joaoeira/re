import { GeneralSettings } from "./general-settings";
import { useSettingsPageActions, useSettingsPageSelector } from "./settings-page-context";

export function GeneralSettingsSection() {
  const rootPath = useSettingsPageSelector((s) => s.context.rootPath);
  const saving = useSettingsPageSelector((s) => s.context.rootPathSaving);
  const error = useSettingsPageSelector((s) => s.context.rootPathError);
  const actions = useSettingsPageActions();

  return (
    <GeneralSettings
      rootPath={rootPath}
      saving={saving}
      error={error}
      onSelectDirectory={actions.selectDirectory}
      onClearRootPath={actions.clearRootPath}
    />
  );
}
