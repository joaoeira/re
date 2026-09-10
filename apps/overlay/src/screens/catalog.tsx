import type { ReactNode } from "react";
import type { Notice } from "../notice";
import type { DraftFieldName, DraftFieldState } from "../ui/field";
import { ActionsMenu, type MenuItem } from "./actions-menu";
import { CreateScreen, CreateSelectors, type CreateScreenProps } from "./create-screen";
import { DeleteDialog } from "./delete-dialog";
import { EditScreen } from "./edit-screen";
import { PreviewScreen, type PreviewScreenProps } from "./preview-screen";
import { ReviewScreen, type ReviewScreenProps, type ReviewView } from "./review-screen";
import { Shell, type Command } from "./shell";

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

const command = (label: string, keys?: string, primary = false): Command => ({
  label,
  keys,
  primary,
  onClick: noop,
});
const createCommand = command("Create card", "⌘ ↵", true);
const showAnswer = [command("Show answer", "Space", true)];
const grading = [
  command("Again", "1"),
  command("Hard", "2"),
  command("Good", "Space / 3", true),
  command("Easy", "4"),
];
const newSession = [command("New session", "⌘ R", true)];

const selectors = (cardType: "qa" | "cloze", open: "deck" | "type" | null = null) => (
  <CreateSelectors
    cardType={cardType}
    deck={{
      value: mainDeck,
      options: decks,
      open: open === "deck",
      onOpenChange: noop,
      onChange: noop,
    }}
    type={{ open: open === "type", onOpenChange: noop, onChange: noop }}
  />
);

const createScreen = (overrides: Partial<CreateScreenProps> = {}) => (
  <CreateScreen
    editorKey={0}
    cardType="qa"
    draft={{ question: "", answer: "", content: "" }}
    initialFocus="question"
    field={fields("question")}
    onChange={noop}
    onInsertCloze={noop}
    {...overrides}
  />
);
const previewScreen = (props: Omit<PreviewScreenProps, "deckPath">) => (
  <PreviewScreen deckPath={mainDeck} {...props} />
);
const reviewScreen = (view: ReviewView, overrides: Partial<ReviewScreenProps> = {}) => (
  <ReviewScreen view={view} issues={[]} onOpenDeck={noop} onChooseWorkspace={noop} {...overrides} />
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
const qaPreview = [{ question: "What does the mitochondrion produce?", answer: "ATP." }];
const clozePreview = [
  { question: "The […] produces ATP.", answer: "The mitochondrion produces ATP." },
  { question: "The mitochondrion produces […].", answer: "The mitochondrion produces ATP." },
];
const qaEdit = (
  <EditScreen
    draft={{ cardType: "qa", question: "delete", answer: "this" }}
    field={fields("question")}
    onChange={noop}
  />
);

const item = (label: string, key = ""): MenuItem => ({ label, key, run: noop });
const commonItems = (restart: boolean) => [
  item("Choose workspace…"),
  item("Stop keeping on top", "⌘ ⇧ P"),
  ...(restart ? [item("Restart review")] : []),
  item("Close window", "Esc"),
  item("Quit", "⌘ Q"),
];
const menu = (items: readonly MenuItem[]) => (
  <ActionsMenu items={items} activeIndex={0} onActivate={noop} onSelect={noop} />
);

interface WindowProps {
  readonly context?: string;
  readonly selectors?: ReactNode;
  readonly commands: readonly Command[];
  readonly undo?: boolean;
  readonly notice?: Notice;
  readonly body: ReactNode;
  readonly overlays?: ReactNode;
}
const window = ({ context, selectors, commands, undo, notice, body, overlays }: WindowProps) => (
  <Shell
    onBack={noop}
    onUndo={undo ? noop : undefined}
    onActions={noop}
    notice={notice ?? null}
    footer={{ context, selectors, commands }}
    overlays={overlays}
  >
    {body}
  </Shell>
);
const createWindow = (
  body: ReactNode,
  cardType: "qa" | "cloze" = "qa",
  extra: Partial<WindowProps> = {},
) =>
  window({
    selectors: selectors(cardType, extra.selectors === undefined ? null : null),
    commands: [createCommand],
    body,
    ...extra,
  });

export const screenStates: readonly ScreenState[] = [
  {
    id: "01-create-qa",
    title: "Create — Question and Answer",
    render: () => createWindow(createScreen()),
  },
  {
    id: "02-create-cloze",
    title: "Create — Cloze",
    render: () =>
      createWindow(createScreen({ cardType: "cloze", field: fields("content") }), "cloze"),
  },
  {
    id: "03-deck-picker",
    title: "Deck picker",
    render: () =>
      window({
        selectors: selectors("cloze", "deck"),
        commands: [createCommand],
        body: createScreen({ cardType: "cloze" }),
      }),
  },
  {
    id: "04-card-type-picker",
    title: "Card type picker",
    render: () =>
      window({
        selectors: selectors("cloze", "type"),
        commands: [createCommand],
        body: createScreen({ cardType: "cloze" }),
      }),
  },
  {
    id: "05-create-actions",
    title: "Create Actions",
    render: () =>
      createWindow(createScreen({ cardType: "cloze", field: fields("content") }), "cloze", {
        overlays: menu([
          item("Preview card", "⌘ P"),
          item("Insert cloze template", "⌘ ⇧ C"),
          item("Insert image from clipboard", "⌘ I"),
          item("Refresh decks", "⌘ R"),
          item("Close after creating"),
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
        selectors: selectors("cloze", "deck"),
        commands: [createCommand],
        body: createScreen({ cardType: "cloze" }),
      }),
  },
  {
    id: "07-deck-search-no-matches",
    title: "Deck search — no matches",
    typed: { testId: "deck-search", keys: "a s t r o n o m y" },
    render: () =>
      window({
        selectors: selectors("cloze", "deck"),
        commands: [createCommand],
        body: createScreen({ cardType: "cloze" }),
      }),
  },
  {
    id: "08-preview-qa",
    title: "Preview — Question and Answer",
    render: () =>
      window({
        context: "Preview · 1 of 1",
        commands: [command("Edit", "⌘ P"), createCommand],
        body: previewScreen({ cards: qaPreview, index: 0 }),
      }),
  },
  {
    id: "09-preview-cloze",
    title: "Preview — Cloze 1 of 2",
    render: () =>
      window({
        context: "Preview · 1 of 2",
        commands: [command("Next", "⌥ →"), command("Edit", "⌘ P"), createCommand],
        body: previewScreen({ cards: clozePreview, index: 0 }),
      }),
  },
  {
    id: "10-create-validation-error",
    title: "Create — Validation error",
    render: () =>
      createWindow(createScreen({ field: fields("question", { question: "Enter a question." }) })),
  },
  {
    id: "11-create-success-notice",
    title: "Create — Success notice",
    render: () =>
      createWindow(createScreen(), "qa", { notice: { tone: "success", text: "Card created" } }),
  },
  {
    id: "12-create-saving",
    title: "Create — Saving",
    render: () =>
      createWindow(
        createScreen({
          draft: { question: "What does the mitochondrion produce?", answer: "ATP.", content: "" },
          field: fields(undefined, {}, true),
        }),
        "qa",
        { commands: [command("Saving…")] },
      ),
  },
  {
    id: "13-create-cloze-validation",
    title: "Create — Cloze validation",
    render: () =>
      createWindow(
        createScreen({
          cardType: "cloze",
          draft: { question: "", answer: "", content: "The mitochondrion produces ATP." },
          field: fields("content", {
            content: "No cloze deletions found (expected {{c1::...}} syntax)",
          }),
        }),
        "cloze",
      ),
  },
  {
    id: "14-review-qa-prompt",
    title: "Review — Question and Answer — prompt",
    render: () =>
      window({ context: "main · 1 left", commands: showAnswer, body: reviewScreen(qaCard(false)) }),
  },
  {
    id: "15-review-qa-revealed",
    title: "Review — Question and Answer — revealed",
    render: () =>
      window({ context: "main · 1 left", commands: grading, body: reviewScreen(qaCard(true)) }),
  },
  {
    id: "16-review-cloze-prompt",
    title: "Review — Cloze — prompt",
    render: () =>
      window({
        context: "main · 1 left",
        commands: showAnswer,
        body: reviewScreen(clozeCard(false)),
      }),
  },
  {
    id: "17-review-cloze-revealed",
    title: "Review — Cloze — revealed",
    render: () =>
      window({ context: "main · 1 left", commands: grading, body: reviewScreen(clozeCard(true)) }),
  },
  {
    id: "18-review-complete",
    title: "Review — Complete",
    render: () =>
      window({
        context: "Review · 0 left",
        commands: newSession,
        undo: true,
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
        context: "Review · 0 left",
        commands: newSession,
        body: reviewScreen({ kind: "empty" }),
      }),
  },
  {
    id: "20-review-actions",
    title: "Review Actions",
    render: () =>
      window({
        context: "main · 1 left",
        commands: showAnswer,
        undo: true,
        body: reviewScreen(qaCard(false)),
        overlays: menu([
          item("Undo last review", "⌘ Z"),
          item("Edit card", "⌘ E"),
          item("Delete card", "⌘ ⌫"),
          item("Open deck", "⌘ O"),
          ...commonItems(true),
        ]),
      }),
  },
  {
    id: "21-edit-qa",
    title: "Edit — Question and Answer",
    render: () =>
      window({
        context: "main · Editing card",
        commands: [command("Discard", "Esc"), command("Save changes", "⌘ ↵", true)],
        body: qaEdit,
      }),
  },
  {
    id: "22-edit-cloze",
    title: "Edit — Cloze note",
    render: () =>
      window({
        context: "main · Editing cloze note",
        commands: [command("Discard", "Esc"), command("Save changes", "⌘ ↵", true)],
        body: (
          <EditScreen
            draft={{
              cardType: "cloze",
              content: "The {{c1::mitochondrion}} produces {{c2::ATP}}.",
            }}
            field={fields("content")}
            onChange={noop}
          />
        ),
      }),
  },
  {
    id: "23-delete-card",
    title: "Delete — Card confirmation",
    render: () =>
      window({
        context: "main · 1 left",
        commands: showAnswer,
        body: reviewScreen(qaCard(false)),
        overlays: <DeleteDialog cardType="qa" cardCount={1} onCancel={noop} onConfirm={noop} />,
      }),
  },
  {
    id: "24-delete-cloze-note",
    title: "Delete — Cloze note confirmation",
    render: () =>
      window({
        context: "main · 1 left",
        commands: showAnswer,
        body: reviewScreen(clozeCard(false)),
        overlays: <DeleteDialog cardType="cloze" cardCount={2} onCancel={noop} onConfirm={noop} />,
      }),
  },
  {
    id: "25-review-loading-session",
    title: "Review — Loading session",
    render: () =>
      window({ context: "Review", commands: [], body: reviewScreen({ kind: "loading" }) }),
  },
  {
    id: "26-review-loading-card",
    title: "Review — Loading card",
    render: () =>
      window({
        context: "main · 1 left",
        commands: [],
        body: reviewScreen({ kind: "loadingCard" }),
      }),
  },
  {
    id: "27-review-could-not-start",
    title: "Review — Could not start",
    render: () =>
      window({
        context: "Review",
        commands: [command("Retry", "⌘ R", true)],
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
        context: "main · 1 left",
        commands: [command("Skip card"), command("Retry card", "⌘ R", true)],
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
        context: "main · 1 left",
        commands: showAnswer,
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
        context: "main · 1 left",
        commands: grading,
        notice: { tone: "error", text: "Could not save: The deck could not be written." },
        body: reviewScreen(qaCard(true)),
      }),
  },
  {
    id: "31-create-qa-actions",
    title: "Create Q&A Actions",
    render: () =>
      createWindow(createScreen(), "qa", {
        overlays: menu([
          item("Preview card", "⌘ P"),
          item("Insert image from clipboard", "⌘ I"),
          item("Refresh decks", "⌘ R"),
          item("Close after creating"),
          ...commonItems(false),
        ]),
      }),
  },
  {
    id: "32-preview-actions",
    title: "Preview Actions",
    render: () =>
      window({
        context: "Preview · 1 of 1",
        commands: [command("Edit", "⌘ P"), createCommand],
        body: previewScreen({ cards: qaPreview, index: 0 }),
        overlays: menu([
          item("Edit card", "⌘ P"),
          item("Close after creating"),
          ...commonItems(false),
        ]),
      }),
  },
  {
    id: "33-edit-actions",
    title: "Edit Actions",
    render: () =>
      window({
        context: "main · Editing card",
        commands: [command("Discard", "Esc"), command("Save changes", "⌘ ↵", true)],
        body: qaEdit,
        overlays: menu([
          item("Save changes", "⌘ ↵"),
          item("Discard changes", "Esc"),
          ...commonItems(false),
        ]),
      }),
  },
  {
    id: "34-empty-review-actions",
    title: "Empty Review Actions",
    render: () =>
      window({
        context: "Review · 0 left",
        commands: newSession,
        body: reviewScreen({ kind: "empty" }),
        overlays: menu(commonItems(true)),
      }),
  },
  {
    id: "35-card-error-actions",
    title: "Card Error Actions",
    render: () =>
      window({
        context: "main · 1 left",
        commands: [command("Skip card"), command("Retry card", "⌘ R", true)],
        body: reviewScreen({
          kind: "cardError",
          error: "Card no longer exists.",
          deckPath: mainDeck,
        }),
        overlays: menu([
          item("Open deck", "⌘ O"),
          item("Retry card", "⌘ R"),
          item("Skip card"),
          ...commonItems(true),
        ]),
      }),
  },
  {
    id: "36-cloze-review-actions",
    title: "Cloze Review Actions",
    render: () =>
      window({
        context: "main · 1 left",
        commands: showAnswer,
        body: reviewScreen(clozeCard(false)),
        overlays: menu([
          item("Edit cloze note", "⌘ E"),
          item("Delete cloze note", "⌘ ⌫"),
          item("Open deck", "⌘ O"),
          ...commonItems(true),
        ]),
      }),
  },
];
