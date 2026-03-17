import { useMemo } from "react";
import { ChevronDown } from "lucide-react";

import type { AiModelDefinition, AiProviderId } from "@shared/ai-models";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PROVIDER_DISPLAY_NAMES: Record<AiProviderId, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

const PROVIDER_ORDER: readonly AiProviderId[] = ["openrouter", "openai", "anthropic", "gemini"];

type ModelsByProvider = ReadonlyArray<{
  readonly providerId: AiProviderId;
  readonly displayName: string;
  readonly models: readonly AiModelDefinition[];
}>;

function groupModelsByProvider(models: readonly AiModelDefinition[]): ModelsByProvider {
  const groups = new Map<AiProviderId, AiModelDefinition[]>();

  for (const model of models) {
    const existing = groups.get(model.providerId);
    if (existing) {
      existing.push(model);
    } else {
      groups.set(model.providerId, [model]);
    }
  }

  return PROVIDER_ORDER.filter((id) => groups.has(id)).map((id) => ({
    providerId: id,
    displayName: PROVIDER_DISPLAY_NAMES[id],
    models: groups.get(id)!,
  }));
}

export function ModelsSettings({
  models,
  defaultModelKey,
  applicationDefaultModelKey,
  saving,
  error,
  onDefaultModelChange,
}: {
  models: readonly AiModelDefinition[];
  defaultModelKey: string | null;
  applicationDefaultModelKey: string | null;
  saving: boolean;
  error: string | null;
  onDefaultModelChange: (modelKey: string | null) => void;
}) {
  const grouped = useMemo(() => groupModelsByProvider(models), [models]);

  const effectiveModelKey = defaultModelKey ?? applicationDefaultModelKey;
  const selectedModel = models.find((m) => m.key === effectiveModelKey) ?? null;
  const providerLabel = selectedModel ? PROVIDER_DISPLAY_NAMES[selectedModel.providerId] : null;

  const handleValueChange = (value: string) => {
    if (value === applicationDefaultModelKey) {
      onDefaultModelChange(null);
    } else {
      onDefaultModelChange(value);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          Default model
        </span>

        <div className="mt-1 flex items-baseline gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={saving || models.length === 0}
              className="flex items-baseline gap-2 outline-none"
            >
              <span className="text-xs font-semibold text-foreground">
                {selectedModel?.displayName ?? "No model selected"}
              </span>
              {providerLabel && (
                <span className="text-xs text-muted-foreground">{providerLabel}</span>
              )}
              <ChevronDown className="relative top-px size-3.5 text-muted-foreground/60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={8} className="min-w-64">
              <DropdownMenuRadioGroup
                value={effectiveModelKey ?? ""}
                onValueChange={handleValueChange}
              >
                {grouped.map((group) => (
                  <DropdownMenuGroup key={group.providerId}>
                    <DropdownMenuLabel className="font-semibold text-foreground">
                      {group.displayName}
                    </DropdownMenuLabel>
                    {group.models.map((model) => (
                      <DropdownMenuRadioItem key={model.key} value={model.key}>
                        {model.displayName}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuGroup>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
