import { useState } from "react";

export type ApiKeyState = {
  configured: boolean;
  saving: boolean;
  error: string | null;
};

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

export function ApiKeyField({
  label,
  configured,
  saving,
  error,
  onSave,
  onRemove,
}: {
  label: string;
  configured: boolean;
  saving: boolean;
  error: string | null;
  onSave: (value: string) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState("");

  const handleSave = () => {
    if (value.trim()) {
      onSave(value.trim());
      setValue("");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          className={`size-2 rounded-full ${configured ? "bg-green-500" : "bg-muted-foreground/30"}`}
        />
        <span className="text-sm font-medium">{label}</span>
        <span className="text-muted-foreground text-xs">
          {configured ? "Configured" : "Not configured"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={configured ? "Enter new key to update" : "Enter API key"}
          className="border-border bg-background text-foreground placeholder:text-muted-foreground h-8 flex-1 border px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
        />
        <Button size="sm" disabled={!value.trim() || saving} onClick={handleSave}>
          {saving ? "Saving..." : "Save"}
        </Button>
        {configured && (
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="destructive" size="sm" disabled={saving} />}
            >
              Remove
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove API key</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the stored {label}. You can add a new one later.
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
        )}
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
