import { SecretsSettings } from "./secrets-settings";
import { useSettingsPageActions, useSettingsPageState } from "./settings-page-context";

export function SecretsSettingsSection() {
  const { apiKeys } = useSettingsPageState();
  const actions = useSettingsPageActions();

  return (
    <SecretsSettings
      apiKeys={apiKeys}
      onSaveKey={actions.saveKey}
      onRemoveKey={actions.removeKey}
    />
  );
}
