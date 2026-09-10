import { colors, column, font, menuSurface, row } from "../theme";
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
      <div style={{ ...menuSurface, ...column, width: 400, maxWidth: "90%", padding: 24, gap: 16 }}>
        <text style={{ color: colors.text, fontSize: font.title }}>
          {cardType === "cloze" ? "Delete Cloze Note?" : "Delete Card?"}
        </text>
        <text style={{ color: colors.muted, fontSize: font.input }}>
          {cardType === "cloze"
            ? `This removes the note and all ${cardCount} cards it creates.`
            : "This removes the card from its deck."}
        </text>
        <text style={{ color: colors.muted, fontSize: font.input }}>
          You can undo this during the current review session.
        </text>
        <div style={{ ...row, justifyContent: "flex-end", gap: 12 }}>
          <Action label="Cancel" keys="Esc" testId="cancel-delete" onClick={onCancel} />
          <Action label="Delete" keys="⌘ ↵" testId="confirm-delete" onClick={onConfirm} />
        </div>
      </div>
    </div>
  );
}
