import type { SecretKey } from "@shared/secrets";
import { ApiKeyField, type ApiKeyState } from "./api-key-field";

export function SecretsSettings({
  apiKeys,
  onSaveKey,
  onRemoveKey,
}: {
  apiKeys: Record<SecretKey, ApiKeyState>;
  onSaveKey: (key: SecretKey, value: string) => void;
  onRemoveKey: (key: SecretKey) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">API keys</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Keys are stored securely in your system keychain.
        </p>
      </div>

      <ApiKeyField
        label="OpenAI"
        configured={apiKeys["openai-api-key"].configured}
        saving={apiKeys["openai-api-key"].saving}
        error={apiKeys["openai-api-key"].error}
        onSave={(value) => onSaveKey("openai-api-key", value)}
        onRemove={() => onRemoveKey("openai-api-key")}
      />

      <ApiKeyField
        label="Anthropic"
        configured={apiKeys["anthropic-api-key"].configured}
        saving={apiKeys["anthropic-api-key"].saving}
        error={apiKeys["anthropic-api-key"].error}
        onSave={(value) => onSaveKey("anthropic-api-key", value)}
        onRemove={() => onRemoveKey("anthropic-api-key")}
      />
    </div>
  );
}
