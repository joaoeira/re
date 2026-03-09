import { useTheme } from "@/lib/theme-context";
import { GeneralSettings } from "./general-settings";
import { useSettingsPageActions, useSettingsPageState } from "./settings-page-context";

export function GeneralSettingsSection() {
  const { rootPath, rootPathSaving, rootPathError } = useSettingsPageState();
  const actions = useSettingsPageActions();
  const { theme, setTheme } = useTheme();

  return (
    <GeneralSettings
      rootPath={rootPath}
      saving={rootPathSaving}
      error={rootPathError}
      theme={theme}
      onSelectDirectory={actions.selectDirectory}
      onClearRootPath={actions.clearRootPath}
      onThemeChange={setTheme}
    />
  );
}
