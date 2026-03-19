import { useMemo } from "react";
import { ChevronDown, Plus, X } from "lucide-react";

import type { AiModelDefinition, AiProviderId } from "@shared/ai-models";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "../ui/button";

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

function ModelSelector({
  models,
  grouped,
  selectedModelKey,
  disabled,
  onModelChange,
}: {
  models: readonly AiModelDefinition[];
  grouped: ModelsByProvider;
  selectedModelKey: string | null;
  disabled: boolean;
  onModelChange: (modelKey: string) => void;
}) {
  const selectedModel = models.find((m) => m.key === selectedModelKey) ?? null;
  const providerLabel = selectedModel ? PROVIDER_DISPLAY_NAMES[selectedModel.providerId] : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="flex items-center">
            {providerLabel && (
              <>
                <span className="text-xs text-muted-foreground">{providerLabel}</span>
                <span className="mx-1 text-muted-foreground">&middot;</span>
              </>
            )}
            <span className="text-xs font-medium text-foreground">
              {selectedModel?.displayName ?? "Select model"}
            </span>
            <ChevronDown className="size-3 text-muted-foreground ml-2" />
          </Button>
        }
        disabled={disabled}
      ></DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="min-w-56">
        <DropdownMenuRadioGroup value={selectedModelKey ?? ""} onValueChange={onModelChange}>
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
  );
}

type PromptTask = { readonly promptId: string; readonly displayName: string };

export function ModelsSettings({
  models,
  defaultModelKey,
  applicationDefaultModelKey,
  saving,
  error,
  onDefaultModelChange,
  promptTasks,
  promptTasksLoading,
  promptModelOverrides,
  overrideSaving,
  overrideError,
  onOverrideChange,
}: {
  models: readonly AiModelDefinition[];
  defaultModelKey: string | null;
  applicationDefaultModelKey: string | null;
  saving: boolean;
  error: string | null;
  onDefaultModelChange: (modelKey: string | null) => void;
  promptTasks: ReadonlyArray<PromptTask>;
  promptTasksLoading: boolean;
  promptModelOverrides: Readonly<Record<string, string>>;
  overrideSaving: boolean;
  overrideError: string | null;
  onOverrideChange: (promptId: string, modelKey: string | null) => void;
}) {
  const grouped = useMemo(() => groupModelsByProvider(models), [models]);
  const effectiveModelKey = defaultModelKey ?? applicationDefaultModelKey;
  const anySaving = saving || overrideSaving;

  const overrideEntries = useMemo(() => {
    const tasksByPromptId = new Map(promptTasks.map((t) => [t.promptId, t]));
    return Object.entries(promptModelOverrides).map(([promptId, modelKey]) => ({
      promptId,
      modelKey,
      displayName: tasksByPromptId.get(promptId)?.displayName ?? promptId,
    }));
  }, [promptModelOverrides, promptTasks]);

  const availableTasks = useMemo(
    () => promptTasks.filter((t) => !Object.hasOwn(promptModelOverrides, t.promptId)),
    [promptTasks, promptModelOverrides],
  );

  const handleDefaultModelChange = (value: string) => {
    if (value === applicationDefaultModelKey) {
      onDefaultModelChange(null);
    } else {
      onDefaultModelChange(value);
    }
  };

  const handleAddOverride = (promptId: string) => {
    if (effectiveModelKey) {
      onOverrideChange(promptId, effectiveModelKey);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          Default model
        </span>

        <div className="mt-1">
          <ModelSelector
            models={models}
            grouped={grouped}
            selectedModelKey={effectiveModelKey}
            disabled={anySaving || models.length === 0}
            onModelChange={handleDefaultModelChange}
          />
        </div>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      {availableTasks.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={anySaving}
            className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground outline-none disabled:opacity-50 transition-[color,transform] duration-150 ease-out active:scale-[0.97]"
          >
            <Plus className="size-3" />
            Add task override
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={8} className="min-w-48">
            {availableTasks.map((task) => (
              <DropdownMenuItem
                key={task.promptId}
                onClick={() => handleAddOverride(task.promptId)}
              >
                {task.displayName}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {promptTasksLoading ? (
        <p className="text-[10px] text-muted-foreground">Loading tasks...</p>
      ) : (
        <div className="space-y-2">
          {overrideEntries.map((entry) => (
            <div key={entry.promptId} className="flex items-center gap-3">
              <span className="w-40 shrink-0 text-xs text-muted-foreground">
                {entry.displayName}
              </span>
              <ModelSelector
                models={models}
                grouped={grouped}
                selectedModelKey={entry.modelKey}
                disabled={anySaving}
                onModelChange={(modelKey) => onOverrideChange(entry.promptId, modelKey)}
              />
              <button
                type="button"
                disabled={anySaving}
                className="text-muted-foreground/50 hover:text-foreground disabled:opacity-50 transition-[color,transform] duration-100 ease-out active:scale-[0.90]"
                onClick={() => onOverrideChange(entry.promptId, null)}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {overrideError && <p className="text-destructive text-xs">{overrideError}</p>}
    </div>
  );
}
