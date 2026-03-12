import { SECRET_KEYS, type SecretKey } from "@shared/secrets";
import { ProviderKeyRow, type ApiKeyState } from "./provider-key-row";

const PROVIDERS_BY_KEY = {
  "openai-api-key": {
    providerName: "OpenAI",
    preview: "••••••••••••",
  },
  "anthropic-api-key": {
    providerName: "Anthropic",
    preview: "••••••••••••",
  },
  "gemini-api-key": {
    providerName: "Gemini",
    preview: "••••••••••••",
  },
  "openrouter-api-key": {
    providerName: "OpenRouter",
    preview: "••••••••••••",
  },
} satisfies Record<
  SecretKey,
  {
    readonly providerName: string;
    readonly preview: string;
  }
>;

const PROVIDERS: ReadonlyArray<{
  readonly key: SecretKey;
  providerName: string;
  preview: string;
}> = SECRET_KEYS.map((key) => ({
  key,
  ...PROVIDERS_BY_KEY[key],
}));

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
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">API keys</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Keys are stored securely in your system keychain.
        </p>
      </div>

      <div className="space-y-2">
        {PROVIDERS.map((provider) => (
          <ProviderKeyRow
            key={provider.key}
            providerName={provider.providerName}
            preview={provider.preview}
            configured={apiKeys[provider.key].configured}
            saving={apiKeys[provider.key].saving}
            error={apiKeys[provider.key].error}
            onSave={(value) => onSaveKey(provider.key, value)}
            onRemove={() => onRemoveKey(provider.key)}
          />
        ))}
      </div>
    </div>
  );
}
