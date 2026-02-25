import { useEffect, useReducer, useRef } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export type ApiKeyState = {
  configured: boolean;
  saving: boolean;
  error: string | null;
};

type RowState = {
  isHovered: boolean;
  isEditing: boolean;
  inputValue: string;
  pendingSave: boolean;
  sawSaving: boolean;
};

type RowAction =
  | { type: "hoverChanged"; hovered: boolean }
  | { type: "startEditing" }
  | { type: "cancelEditing" }
  | { type: "setInputValue"; value: string }
  | { type: "saveRequested" }
  | { type: "saveStarted" }
  | { type: "saveFinished"; configured: boolean; error: string | null };

const initialRowState: RowState = {
  isHovered: false,
  isEditing: false,
  inputValue: "",
  pendingSave: false,
  sawSaving: false,
};

function rowReducer(state: RowState, action: RowAction): RowState {
  switch (action.type) {
    case "hoverChanged":
      return { ...state, isHovered: action.hovered };
    case "startEditing":
      return { ...state, isEditing: true };
    case "cancelEditing":
      return { ...state, isEditing: false, inputValue: "", pendingSave: false, sawSaving: false };
    case "setInputValue":
      return { ...state, inputValue: action.value };
    case "saveRequested":
      return { ...state, pendingSave: true, sawSaving: false };
    case "saveStarted":
      if (state.sawSaving) return state;
      return { ...state, sawSaving: true };
    case "saveFinished": {
      const nextState = { ...state, pendingSave: false, sawSaving: false };
      if (!action.error && action.configured) {
        return { ...nextState, isEditing: false, inputValue: "" };
      }
      return nextState;
    }
  }
}

export function ProviderKeyRow({
  providerName,
  configured,
  saving,
  error,
  preview,
  onSave,
  onRemove,
}: {
  providerName: string;
  configured: boolean;
  saving: boolean;
  error: string | null;
  preview: string;
  onSave: (value: string) => void;
  onRemove: () => void;
}) {
  const [state, dispatch] = useReducer(rowReducer, initialRowState);
  const inputRef = useRef<HTMLInputElement>(null);
  const { isHovered, isEditing, inputValue, pendingSave, sawSaving } = state;

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!pendingSave) return;

    if (saving) {
      if (!sawSaving) dispatch({ type: "saveStarted" });
      return;
    }

    if (!sawSaving) return;

    dispatch({ type: "saveFinished", configured, error });
  }, [configured, error, pendingSave, sawSaving, saving]);

  const openEditor = () => {
    if (saving) return;
    dispatch({ type: "startEditing" });
  };

  const cancelEditor = () => {
    if (saving) return;
    dispatch({ type: "cancelEditing" });
  };

  const handleSave = () => {
    const value = inputValue.trim();
    if (!value || saving) return;

    onSave(value);
    dispatch({ type: "saveRequested" });
  };

  const showConfiguredActions = configured && !isEditing && isHovered;

  return (
    <div
      role="group"
      aria-label={`${providerName} API key`}
      className={`space-y-2 rounded-md px-2 py-2 transition-colors ${
        isHovered ? "bg-muted/30" : "bg-transparent"
      }`}
      onMouseEnter={() => dispatch({ type: "hoverChanged", hovered: true })}
      onMouseLeave={() => dispatch({ type: "hoverChanged", hovered: false })}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`size-2 rounded-full ${configured ? "bg-green-500" : "bg-muted-foreground/30"}`}
        />
        <span className="text-sm font-medium">{providerName}</span>

        {configured && !isEditing && (
          <button
            type="button"
            aria-label={`${providerName} key preview`}
            className="text-muted-foreground hover:text-foreground font-mono text-xs tracking-wide transition-colors cursor-pointer ml-2"
            onClick={openEditor}
            disabled={saving}
          >
            {preview}
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {configured && !isEditing ? (
            <div
              className={`flex items-center gap-2 transition-opacity ${
                showConfiguredActions ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <button
                type="button"
                aria-label={`Replace ${providerName} key`}
                className="text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
                onClick={openEditor}
                disabled={saving}
              >
                Replace
              </button>

              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label={`Remove ${providerName} key`}
                      disabled={saving}
                    />
                  }
                >
                  Remove
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove API key</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete the stored {providerName} key. You can add a new
                      one later.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={onRemove}>
                      Remove
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : null}

          {!configured && !isEditing ? (
            <button
              type="button"
              aria-label={`Add ${providerName} key`}
              className="text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
              onClick={openEditor}
              disabled={saving}
            >
              Add key
            </button>
          ) : null}
        </div>
      </div>

      {isEditing ? (
        <div className="flex items-center gap-2 pl-4">
          <input
            ref={inputRef}
            type="password"
            aria-label={`${providerName} API key`}
            value={inputValue}
            onChange={(e) => dispatch({ type: "setInputValue", value: e.target.value })}
            placeholder={configured ? "Enter new key to update" : "Enter API key"}
            className="border-border bg-background text-foreground placeholder:text-muted-foreground h-8 flex-1 border px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                cancelEditor();
              }
            }}
          />

          <Button
            size="sm"
            aria-label={`Save ${providerName} key`}
            disabled={!inputValue.trim() || saving}
            onClick={handleSave}
          >
            {saving ? "Saving..." : "Save"}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            aria-label={`Cancel ${providerName} key edit`}
            disabled={saving}
            onClick={cancelEditor}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
