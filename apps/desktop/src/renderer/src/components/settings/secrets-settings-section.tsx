import { SecretsSettings } from "./secrets-settings";
import { useSettingsPageActions, useSettingsPageSelector } from "./settings-page-context";

export function SecretsSettingsSection() {
  const apiKeys = useSettingsPageSelector((s) => s.context.apiKeys);
  const actions = useSettingsPageActions();

  return (
    <SecretsSettings
      apiKeys={apiKeys}
      onSaveKey={actions.saveKey}
      onRemoveKey={actions.removeKey}
    />
  );
}
