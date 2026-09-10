import { colors, column, row, type } from "../theme";
import { Action } from "../ui/action";

export interface DeleteDialogProps {
  readonly cardType: "qa" | "cloze";
  readonly cardCount: number;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function DeleteDialog({ cardType, cardCount, onCancel, onConfirm }: DeleteDialogProps) {
  return (
    <div
      style={{
        ...column,
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        backgroundColor: colors.scrim,
        justifyContent: "center",
        alignItems: "center",
      }}
      onClick={() => {}}
    >
      <div
        style={{
          ...column,
          width: 520,
          maxWidth: "90%",
          padding: 24,
          gap: 16,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.surfaceBorder,
          backgroundColor: colors.surface,
        }}
      >
        <text style={{ ...type.title, color: colors.text }}>
          {cardType === "cloze" ? "Delete cloze note?" : "Delete card?"}
        </text>
        <text style={{ ...type.input, color: colors.muted }}>
          {cardType === "cloze"
            ? `This removes the note and all ${cardCount} cards it creates.`
            : "This removes the card from its deck."}
        </text>
        <text style={{ ...type.note, color: colors.muted }}>
          You can undo this during the current review session.
        </text>
        <div style={{ ...row, justifyContent: "flex-end", gap: 12, paddingTop: 4 }}>
          <Action label="Cancel" keys="Esc" testId="cancel-delete" onClick={onCancel} />
          <Action
            label="Delete"
            keys="⌘ ↵"
            tone="danger"
            testId="confirm-delete"
            onClick={onConfirm}
          />
        </div>
      </div>
    </div>
  );
}
