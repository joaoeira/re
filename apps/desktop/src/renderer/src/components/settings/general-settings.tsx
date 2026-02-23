import { Folder, X } from "lucide-react";

import { Button } from "@/components/ui/button";

export function GeneralSettings({
  rootPath,
  saving,
  error,
  onSelectDirectory,
  onClearRootPath,
}: {
  rootPath: string | null;
  saving: boolean;
  error: string | null;
  onSelectDirectory: () => void;
  onClearRootPath: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Workspace root</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          The folder where your decks are stored.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <div className="border-border bg-muted/30 flex h-8 min-w-0 flex-1 items-center gap-2 border px-2">
          <Folder size={14} className="text-muted-foreground shrink-0" />
          <span className="truncate text-xs">
            {rootPath ?? <span className="text-muted-foreground italic">No folder selected</span>}
          </span>
        </div>
        {rootPath && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Clear workspace path"
            disabled={saving}
            onClick={onClearRootPath}
          >
            <X size={14} />
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={saving} onClick={onSelectDirectory}>
          {saving ? "Saving..." : "Browse..."}
        </Button>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
