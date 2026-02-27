import { useState } from "react";

import { ClozePreview } from "@/components/editor/cloze-preview";
import { Button } from "@/components/ui/button";

import { MOCK_CLOZE_TEXT } from "./mock-cards-data";

type ClozePanelProps = {
  readonly onAddCloze: () => void;
};

export function ClozePanel({ onAddCloze }: ClozePanelProps) {
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);

  const handleRegenerate = () => {
    setLoading(true);
    setAdded(false);
    setTimeout(() => setLoading(false), 600);
  };

  return (
    <div className="mt-3 border-t border-dashed border-border/40 pt-3">
      {loading ? (
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground/50">
          <span className="inline-block size-2.5 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-transparent" />
          Converting to cloze…
        </span>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/40">Cloze conversion</span>
            <button
              type="button"
              onClick={handleRegenerate}
              className="text-[11px] text-muted-foreground/40 underline underline-offset-4 decoration-border transition-colors hover:text-foreground/60"
            >
              regenerate
            </button>
          </div>
          <div className="bg-muted/20 px-4 py-3">
            <ClozePreview content={MOCK_CLOZE_TEXT} />
          </div>
          <div className="mt-3">
            {added ? (
              <span className="text-[11px] text-primary">✓ Added to deck</span>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={() => {
                  setAdded(true);
                  onAddCloze();
                }}
              >
                + Add to deck
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
