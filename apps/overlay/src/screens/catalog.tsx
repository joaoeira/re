import type { ReactNode } from "react";
import type { Notice } from "../notice";
import type { DraftFieldName, DraftFieldState } from "../ui/field";
import { ActionsMenu, type MenuItem } from "./actions-menu";
import { CreateScreen, type CreateScreenProps } from "./create-screen";
import { DeleteDialog } from "./delete-dialog";
import { EditScreen } from "./edit-screen";
import { PreviewScreen } from "./preview-screen";
import { ReviewScreen, type ReviewScreenProps, type ReviewView } from "./review-screen";
import { Shell, type FooterProps } from "./shell";

// Every user-visible state of the window, numbered to match the design
// reference. The gallery script renders each one to a PNG for side-by-side
// comparison; nothing here reaches the shipped app.
export interface ScreenState {
  readonly id: string;
  readonly title: string;
  readonly typed?: { readonly testId: string; readonly keys: string };
  readonly render: () => ReactNode;
}

const noop = () => {};

const decks = [
  { value: "/workspace/main.md", label: "main" },
  { value: "/workspace/messy-jobs.md", label: "Messy Jobs by Luis Garicano et al" },
  { value: "/workspace/economics.md", label: "economics" },
  { value: "/workspace/history.md", label: "history" },
  { value: "/workspace/codigo-da-estrada.md", label: "codigo da estrada" },
  { value: "/workspace/biology.md", label: "biology" },
  { value: "scratch", label: "Overlay (scratch deck)" },
];
const mainDeck = decks[0]!.value;

const fields =
  (
    focused?: DraftFieldName,
    errors: Partial<Record<DraftFieldName, string>> = {},
    readOnly = false,
  ) =>
  (name: DraftFieldName): DraftFieldState => ({
    focused: name === focused,
    error: errors[name],
    readOnly,
    onFocus: noop,
    onBlur: noop,
  });

const createFooter = (label = "Create Card"): FooterProps => ({
  context: "Create Card",
  primary: { label, keys: "⌘ ↵", onClick: noop },
  onActions: noop,
});
const reviewFooter = (
  context: string,
  label: string,
  keys: string,
  grading = false,
): FooterProps => ({
  context,
  grading: grading ? { onAgain: noop, onHard: noop, onEasy: noop } : undefined,
  primary: { label, keys, onClick: noop },
  onActions: noop,
});

const createScreen = (overrides: Partial<CreateScreenProps> = {}) => (
  <CreateScreen
    editorKey={0}
    cardType="qa"
    deck={{ value: mainDeck, options: decks, open: false, onOpenChange: noop, onChange: noop }}
    type={{ open: false, onOpenChange: noop, onChange: noop }}
    draft={{ question: "", answer: "", content: "" }}
    initialFocus="question"
    field={fields("question")}
    onChange={noop}
    {...overrides}
  />
);
const reviewScreen = (view: ReviewView, overrides: Partial<ReviewScreenProps> = {}) => (
  <ReviewScreen
    view={view}
    issues={[]}
    onRestart={noop}
    onReloadCard={noop}
    onSkipCard={noop}
    onOpenDeck={noop}
    onChooseWorkspace={noop}
    {...overrides}
  />
);
const qaCard = (revealed: boolean): ReviewView => ({
  kind: "card",
  cardType: "qa",
  prompt: "delete",
  reveal: "this",
  revealed,
  deckPath: mainDeck,
});
const clozeCard = (revealed: boolean): ReviewView => ({
  kind: "card",
  cardType: "cloze",
  prompt: "The […] produces ATP.",
  reveal: "The mitochondrion produces ATP.",
  revealed,
  deckPath: mainDeck,
});

const item = (label: string, key = ""): MenuItem => ({ label, key, run: noop });
const commonItems = (restart: boolean) => [
  item("Choose Workspace…"),
  item("Stop Keeping on Top", "⌘ ⇧ P"),
  ...(restart ? [item("Restart Review")] : []),
  item("Close Window", "Esc"),
  item("Quit", "⌘ Q"),
];
const menu = (items: readonly MenuItem[]) => (
  <ActionsMenu items={items} activeIndex={0} onActivate={noop} onSelect={noop} />
);

interface WindowProps {
  readonly progress?: string;
  readonly notice?: Notice;
  readonly footer: FooterProps;
  readonly body: ReactNode;
  readonly overlays?: ReactNode;
}
const window = ({ progress, notice, footer, body, overlays }: WindowProps) => (
  <Shell
    onBack={noop}
    progress={progress}
    notice={notice ?? null}
    footer={footer}
    overlays={overlays}
  >
    {body}
  </Shell>
);

export const screenStates: readonly ScreenState[] = [
  {
    id: "01-create-qa",
    title: "Create — Question and Answer",
    render: () => window({ footer: createFooter(), body: createScreen() }),
  },
  {
    id: "02-create-cloze",
    title: "Create — Cloze",
    render: () =>
      window({
        footer: createFooter(),
        body: createScreen({ cardType: "cloze", field: fields("content") }),
      }),
  },
  {
    id: "03-deck-picker",
    title: "Deck picker",
    render: () =>
      window({
        footer: createFooter(),
        body: createScreen({
          cardType: "cloze",
          deck: { value: mainDeck, options: decks, open: true, onOpenChange: noop, onChange: noop },
        }),
      }),
  },
  {
    id: "04-card-type-picker",
    title: "Card type picker",
    render: () =>
      window({
        footer: createFooter(),
        body: createScreen({
          cardType: "cloze",
          type: { open: true, onOpenChange: noop, onChange: noop },
        }),
      }),
  },
  {
    id: "05-create-actions",
    title: "Create Actions",
    render: () =>
      window({
        footer: createFooter(),
        body: createScreen({ cardType: "cloze", field: fields("content") }),
        overlays: menu([
          item("Preview Card", "⌘ P"),
          item("Insert Cloze Template", "⌘ ⇧ C"),
          item("Insert Image from Clipboard", "⌘ I"),
          item("Refresh Decks", "⌘ R"),
          item("Close After Creating"),
          ...commonItems(false),
        ]),
      }),
  },
  {
    id: "06-deck-search-filtered",
    title: "Deck search — filtered",
    typed: { testId: "deck-search", keys: "o" },
    render: () =>
      window({
        footer: createFooter(),
        body: createScreen({
          cardType: "cloze",
          deck: { value: mainDeck, options: decks, open: true, onOpenChange: noop, onChange: noop },
        }),
      }),
  },
  {
    id: "07-deck-search-no-matches",
    title: "Deck search — no matches",
    typed: { testId: "deck-search", keys: "a s t r o n o m y" },
    render: () =>
      window({
        footer: createFooter(),
        body: createScreen({
          cardType: "cloze",
          deck: { value: mainDeck, options: decks, open: true, onOpenChange: noop, onChange: noop },
        }),
      }),
  },
  {
    id: "08-preview-qa",
    title: "Preview — Question and Answer",
    render: () =>
      window({
        footer: createFooter(),
        body: (
          <PreviewScreen
            cards={[{ question: "What does the mitochondrion produce?", answer: "ATP." }]}
            index={0}
            deckPath={mainDeck}
            onEdit={noop}
            onIndexChange={noop}
          />
        ),
      }),
  },
  {
    id: "09-preview-cloze",
    title: "Preview — Cloze 1 of 2",
    render: () =>
      window({
        footer: createFooter(),
        body: (
          <PreviewScreen
            cards={[
              { question: "The […] produces ATP.", answer: "The mitochondrion produces ATP." },
              {
                question: "The mitochondrion produces […].",
                answer: "The mitochondrion produces ATP.",
              },
            ]}
            index={0}
            deckPath={mainDeck}
            onEdit={noop}
            onIndexChange={noop}
          />
        ),
      }),
  },
  {
    id: "10-create-validation-error",
    title: "Create — Validation error",
    render: () =>
      window({
        footer: createFooter(),
        body: createScreen({ field: fields("question", { question: "Enter a question." }) }),
      }),
  },
  {
    id: "11-create-success-notice",
    title: "Create — Success notice",
    render: () =>
      window({
        footer: createFooter(),
        notice: { tone: "success", text: "Card created" },
        body: createScreen(),
      }),
  },
  {
    id: "12-create-saving",
    title: "Create — Saving",
    render: () =>
      window({
        footer: createFooter("Working…"),
        body: createScreen({
          draft: { question: "What does the mitochondrion produce?", answer: "ATP.", content: "" },
          field: fields(undefined, {}, true),
        }),
      }),
  },
  {
    id: "13-create-cloze-validation",
    title: "Create — Cloze validation",
    render: () =>
      window({
        footer: createFooter(),
        body: createScreen({
          cardType: "cloze",
          draft: { question: "", answer: "", content: "The mitochondrion produces ATP." },
          field: fields("content", {
            content: "No cloze deletions found (expected {{c1::...}} syntax)",
          }),
        }),
      }),
  },
  {
    id: "14-review-qa-prompt",
    title: "Review — Question and Answer — prompt",
    render: () =>
      window({
        progress: "0 reviewed · 1 remaining",
        footer: reviewFooter("main", "Show Answer", "Space"),
        body: reviewScreen(qaCard(false)),
      }),
  },
  {
    id: "15-review-qa-revealed",
    title: "Review — Question and Answer — revealed",
    render: () =>
      window({
        progress: "0 reviewed · 1 remaining",
        footer: reviewFooter("main", "Good", "Space / 3", true),
        body: reviewScreen(qaCard(true)),
      }),
  },
  {
    id: "16-review-cloze-prompt",
    title: "Review — Cloze — prompt",
    render: () =>
      window({
        progress: "0 reviewed · 1 remaining",
        footer: reviewFooter("main", "Show Answer", "Space"),
        body: reviewScreen(clozeCard(false)),
      }),
  },
  {
    id: "17-review-cloze-revealed",
    title: "Review — Cloze — revealed",
    render: () =>
      window({
        progress: "0 reviewed · 1 remaining",
        footer: reviewFooter("main", "Good", "Space / 3", true),
        body: reviewScreen(clozeCard(true)),
      }),
  },
  {
    id: "18-review-complete",
    title: "Review — Complete",
    render: () =>
      window({
        progress: "9 reviewed · 0 remaining · ⌘Z Undo",
        footer: reviewFooter("Review Cards", "Close", "Space"),
        body: reviewScreen({
          kind: "complete",
          grades: ["again", "again", "again", "good", "easy", "easy", "easy", "easy", "easy"],
        }),
      }),
  },
  {
    id: "19-review-no-cards-due",
    title: "Review — No cards due",
    render: () =>
      window({
        footer: reviewFooter("Review Cards", "Close", "Space"),
        body: reviewScreen({ kind: "empty" }),
      }),
  },
  {
    id: "20-review-actions",
    title: "Review Actions",
    render: () =>
      window({
        progress: "1 reviewed · 1 remaining · ⌘Z Undo",
        footer: reviewFooter("main", "Show Answer", "Space"),
        body: reviewScreen(qaCard(false)),
        overlays: menu([
          item("Undo Last Review", "⌘ Z"),
          item("Edit Card", "⌘ E"),
          item("Delete Card", "⌘ ⌫"),
          item("Open Deck", "⌘ O"),
          ...commonItems(true),
        ]),
      }),
  },
  {
    id: "21-edit-qa",
    title: "Edit — Question and Answer",
    render: () =>
      window({
        progress: "0 reviewed · 1 remaining",
        footer: reviewFooter("main", "Save Changes", "⌘ ↵"),
        body: (
          <EditScreen
            draft={{ cardType: "qa", question: "delete", answer: "this" }}
            field={fields("question")}
            onChange={noop}
            onDiscard={noop}
          />
        ),
      }),
  },
  {
    id: "22-edit-cloze",
    title: "Edit — Cloze note",
    render: () =>
      window({
        progress: "0 reviewed · 1 remaining",
        footer: reviewFooter("main", "Save Changes", "⌘ ↵"),
        body: (
          <EditScreen
            draft={{
              cardType: "cloze",
              content: "The {{c1::mitochondrion}} produces {{c2::ATP}}.",
            }}
            field={fields("content")}
            onChange={noop}
            onDiscard={noop}
          />
        ),
      }),
  },
  {
    id: "23-delete-card",
    title: "Delete — Card confirmation",
    render: () =>
      window({
        progress: "0 reviewed · 1 remaining",
        footer: reviewFooter("main", "Show Answer", "Space"),
        body: reviewScreen(qaCard(false)),
        overlays: <DeleteDialog cardType="qa" cardCount={1} onCancel={noop} onConfirm={noop} />,
      }),
  },
  {
    id: "24-delete-cloze-note",
    title: "Delete — Cloze note confirmation",
    render: () =>
      window({
        progress: "0 reviewed · 1 remaining",
        footer: reviewFooter("main", "Show Answer", "Space"),
        body: reviewScreen(clozeCard(false)),
        overlays: <DeleteDialog cardType="cloze" cardCount={2} onCancel={noop} onConfirm={noop} />,
      }),
  },
  {
    id: "25-review-loading-session",
    title: "Review — Loading session",
    render: () =>
      window({
        footer: reviewFooter("Review Cards", "Working…", "Space"),
        body: reviewScreen({ kind: "loading" }),
      }),
  },
  {
    id: "26-review-loading-card",
    title: "Review — Loading card",
    render: () =>
      window({
        progress: "0 reviewed · 1 remaining",
        footer: reviewFooter("main", "Working…", "Space"),
        body: reviewScreen({ kind: "loadingCard" }),
      }),
  },
  {
    id: "27-review-could-not-start",
    title: "Review — Could not start",
    render: () =>
      window({
        footer: reviewFooter("Review Cards", "Close", "Space"),
        body: reviewScreen({
          kind: "startError",
          error: "The workspace folder could not be read.",
        }),
      }),
  },
  {
    id: "28-review-card-load-failure",
    title: "Review — Card load failure",
    render: () =>
      window({
        progress: "0 reviewed · 1 remaining",
        footer: reviewFooter("main", "Show Answer", "Space"),
        body: reviewScreen({
          kind: "cardError",
          error: "Card no longer exists.",
          deckPath: mainDeck,
        }),
      }),
  },
  {
    id: "29-review-excluded-decks",
    title: "Review — Excluded decks notice",
    render: () =>
      window({
        progress: "0 reviewed · 1 remaining",
        footer: reviewFooter("main", "Show Answer", "Space"),
        body: reviewScreen(qaCard(false), {
          issues: [
            {
              deckPath: "/workspace/biology.md",
              relativePath: "biology.md",
              kind: "parse_error",
              message: "Could not parse card content.",
            },
          ],
        }),
      }),
  },
  {
    id: "30-review-operation-error",
    title: "Review — Operation error notice",
    render: () =>
      window({
        progress: "0 reviewed · 1 remaining",
        notice: { tone: "error", text: "Could not save: The deck could not be written." },
        footer: reviewFooter("main", "Good", "Space / 3", true),
        body: reviewScreen(qaCard(true)),
      }),
  },
  {
    id: "31-create-qa-actions",
    title: "Create Q&A Actions",
    render: () =>
      window({
        footer: createFooter(),
        body: createScreen(),
        overlays: menu([
          item("Preview Card", "⌘ P"),
          item("Insert Image from Clipboard", "⌘ I"),
          item("Refresh Decks", "⌘ R"),
          item("Close After Creating"),
          ...commonItems(false),
        ]),
      }),
  },
  {
    id: "32-preview-actions",
    title: "Preview Actions",
    render: () =>
      window({
        footer: createFooter(),
        body: (
          <PreviewScreen
            cards={[{ question: "What does the mitochondrion produce?", answer: "ATP." }]}
            index={0}
            deckPath={mainDeck}
            onEdit={noop}
            onIndexChange={noop}
          />
        ),
        overlays: menu([
          item("Edit Card", "⌘ P"),
          item("Close After Creating"),
          ...commonItems(false),
        ]),
      }),
  },
  {
    id: "33-edit-actions",
    title: "Edit Actions",
    render: () =>
      window({
        progress: "0 reviewed · 1 remaining",
        footer: reviewFooter("main", "Save Changes", "⌘ ↵"),
        body: (
          <EditScreen
            draft={{ cardType: "qa", question: "delete", answer: "this" }}
            field={fields("question")}
            onChange={noop}
            onDiscard={noop}
          />
        ),
        overlays: menu([
          item("Save Changes", "⌘ ↵"),
          item("Discard Changes", "Esc"),
          ...commonItems(false),
        ]),
      }),
  },
  {
    id: "34-empty-review-actions",
    title: "Empty Review Actions",
    render: () =>
      window({
        footer: reviewFooter("Review Cards", "Close", "Space"),
        body: reviewScreen({ kind: "empty" }),
        overlays: menu(commonItems(true)),
      }),
  },
  {
    id: "35-card-error-actions",
    title: "Card Error Actions",
    render: () =>
      window({
        progress: "0 reviewed · 1 remaining",
        footer: reviewFooter("main", "Show Answer", "Space"),
        body: reviewScreen({
          kind: "cardError",
          error: "Card no longer exists.",
          deckPath: mainDeck,
        }),
        overlays: menu([
          item("Open Deck", "⌘ O"),
          item("Retry Card", "⌘ R"),
          item("Skip Card"),
          ...commonItems(true),
        ]),
      }),
  },
  {
    id: "36-cloze-review-actions",
    title: "Cloze Review Actions",
    render: () =>
      window({
        progress: "0 reviewed · 1 remaining",
        footer: reviewFooter("main", "Show Answer", "Space"),
        body: reviewScreen(clozeCard(false)),
        overlays: menu([
          item("Edit Cloze Note", "⌘ E"),
          item("Delete Cloze Note", "⌘ ⌫"),
          item("Open Deck", "⌘ O"),
          ...commonItems(true),
        ]),
      }),
  },
];
