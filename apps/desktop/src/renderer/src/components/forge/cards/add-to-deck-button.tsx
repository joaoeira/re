import { Check, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

type AddToDeckButtonProps = {
  readonly isAdded: boolean;
  readonly isAdding: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
};

export function AddToDeckButton({ isAdded, isAdding, disabled, onClick }: AddToDeckButtonProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="xs"
      className="gap-1.5"
      disabled={isAdded || isAdding || disabled}
      onClick={onClick}
    >
      {isAdded ? (
        <Check className="size-3" />
      ) : isAdding ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Plus className="size-3" />
      )}
      {isAdded ? "Card added" : "Add to deck"}
    </Button>
  );
}
