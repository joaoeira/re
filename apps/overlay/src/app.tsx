import { execFile } from "node:child_process";
import { useRef } from "react";
import { appendNextClozeTemplate } from "@simbyotic/re/study";
import type {
  ReviewCardContent,
  ReviewUndoToken,
  ReviewDeleteUndoToken,
  ReviewCardDraft,
  ReviewDeckIssue,
} from "@simbyotic/re/study";
import { gradeSession, removeSessionCards, type SessionProgress } from "./review-session";
import {
  readReviewCard,
  saveReviewEdit,
  undoReviewGrade,
  deleteReviewItem,
  restoreReviewItem,
  previewDraft,
  createWorkspaceCard,
  insertClipboardImage,
} from "./workspace";
import { basename } from "node:path";
import { useEffect, useState, type ReactNode } from "react";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  createRenderer,
  type EventPayload,
} from "@gpuix/react";
import type { DeckEntry } from "@simbyotic/re/workspace";
import { saveCards, type Card } from "./cards";
import { CardMarkdown } from "./card-markdown";
import { DeckCombobox } from "./deck-combobox";
import { toErrorMessage } from "./error-message";
import { type Screen } from "./launch";
import { onSettled } from "./on-settled";
import { panel } from "./panel";
import { statusMenu } from "./review-status";
import { savePreferences, type Preferences } from "./preferences";
import { reviewKey, type ReviewGrade } from "./review-controls";
import { cardsPath } from "./storage";
import { colors, column, editorTheme, menuItem, menuSurface, menuTrigger, row } from "./theme";
import {
  listDecks,
  prepareScratch,
  loadReview,
  loadReviewStatus,
  gradeInDeck,
  type WorkspaceCard,
} from "./workspace";

const isWorkspaceCard = (card: Card | WorkspaceCard): card is WorkspaceCard => "reference" in card;

interface Notice {
  readonly tone: "success" | "error";
  readonly text: string;
}
const failure = (text: string): Notice => ({ tone: "error", text });
const success = (text: string): Notice => ({ tone: "success", text });

function Key({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        ...row,
        justifyContent: "center",
        minWidth: 19,
        height: 20,
        paddingLeft: 4,
        paddingRight: 4,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.field,
      }}
    >
      <text style={{ color: colors.muted, fontSize: 11 }}>{children}</text>
    </div>
  );
}
function Action({
  label,
  keys,
  onClick,
  primary = false,
  testId,
}: {
  label: string;
  keys?: string;
  onClick: () => void;
  primary?: boolean;
  testId?: string;
}) {
  return (
    <div
      testId={testId}
      onClick={onClick}
      style={{
        ...row,
        gap: 7,
        padding: 6,
        borderRadius: 5,
        cursor: "pointer",
        hover: { backgroundColor: colors.hover },
      }}
    >
      <text
        style={{
          color: primary ? colors.text : colors.muted,
          fontSize: 12,
          fontWeight: primary ? 500 : 400,
        }}
      >
        {label}
      </text>
      {keys && <Key>{keys}</Key>}
    </div>
  );
}

function Dropdown({
  value,
  options,
  onChange,
  open,
  onOpenChange,
  testId,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testId: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Select
      value={value}
      onValueChange={onChange}
      open={open}
      onOpenChange={onOpenChange}
      style={{ flexGrow: 1, alignItems: "stretch" }}
    >
      <SelectTrigger
        testId={testId}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ ...menuTrigger, borderColor: focused ? "#ffffff55" : colors.line }}
      >
        <text style={{ color: colors.text, fontSize: 13 }}>
          {options.find((option) => option.value === value)?.label ?? "Choose a deck…"}
        </text>
        <text style={{ color: colors.muted, fontSize: 13 }}>⌄</text>
      </SelectTrigger>
      <SelectContent style={{ ...menuSurface, maxHeight: 235, overflowY: "scroll" }}>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            textValue={option.label}
            style={({ highlighted }) => menuItem(highlighted)}
          >
            <text style={{ color: colors.text, fontSize: 13 }}>{option.label}</text>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <div style={{ ...row, gap: 20 }}>
      <text style={{ width: 70, textAlign: "right", color: colors.muted, fontSize: 12 }}>
        {label}
      </text>
      <div style={{ ...column, flexGrow: 1, minWidth: 0, gap: 5 }}>
        {children}
        {error && <text style={{ color: colors.error, fontSize: 12 }}>{error}</text>}
      </div>
    </div>
  );
}

function DraftField({
  label,
  testId,
  value,
  placeholder,
  rows,
  autoFocus = false,
  focused,
  readOnly,
  onChange,
  onFocus,
  onBlur,
  error,
}: {
  error?: string;
  label: string;
  testId: string;
  value: string;
  placeholder: string;
  rows: number;
  autoFocus?: boolean;
  focused: boolean;
  readOnly: boolean;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  return (
    <Field label={label} error={error}>
      <textarea
        readOnly={readOnly}
        testId={testId}
        autoFocus={autoFocus || undefined}
        value={value}
        onChange={(event) => onChange(event.value ?? "")}
        onFocus={onFocus}
        onClick={onFocus}
        onKeyDown={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        minRows={rows}
        maxRows={rows}
        theme={editorTheme}
        style={{
          flexGrow: 1,
          color: colors.text,
          backgroundColor: colors.field,
          borderRadius: 7,
          borderWidth: 1,
          borderColor: error ? colors.error : focused ? "#ffffff55" : colors.line,
          padding: 12,
          fontSize: 14,
        }}
      />
    </Field>
  );
}

type ScratchUndo =
  | { readonly kind: "scratchGrade"; readonly cardId: string; readonly lastGrade?: ReviewGrade }
  | { readonly kind: "scratchDelete"; readonly entries: readonly { index: number; card: Card }[] };

export interface AppEvents {
  key: (event: EventPayload) => void;
  route: (screen: Screen) => void;
  refresh: () => void;
  preferences: () => void;
}

export interface AppProps {
  readonly renderer: Pick<ReturnType<typeof createRenderer>, "focusNext" | "focusPrevious">;
  readonly events: AppEvents;
  readonly onQuit: () => void;
  readonly initial: {
    readonly screen: Screen;
    readonly preferences: Preferences;
    readonly cards: Card[];
    readonly error?: string;
  };
}

export function App({ renderer, events, onQuit, initial }: AppProps) {
  const initialCards = initial.cards;
  const loadFailure = initial.error ? failure(initial.error) : null;
  const [statusRevision, setStatusRevision] = useState(0);
  const [screen, setScreen] = useState<Screen>(initial.screen);
  const [preferences, setPreferences] = useState(initial.preferences);
  const [decks, setDecks] = useState<readonly DeckEntry[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [cloze, setCloze] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [focus, setFocus] = useState("question");
  const [openSelect, setOpenSelect] = useState<"deck" | "type" | null>(null);
  const [saving, setSaving] = useState(false);
  const [startError, setStartError] = useState<string>();
  const [reviewLoaded, setReviewLoaded] = useState(false);
  const [workspaceCards, setWorkspaceCards] = useState<WorkspaceCard[]>([]);
  const [cards, setCards] = useState(initialCards);
  const [progress, setProgress] = useState<SessionProgress>({
    queue: initialCards.map((card) => card.id),
    grades: [],
  });
  const queue = progress.queue;
  const setQueue = (queue: readonly string[]) => setProgress({ queue, grades: [] });
  const [issues, setIssues] = useState<readonly ReviewDeckIssue[]>([]);
  const [loadedCard, setLoadedCard] = useState<{
    id: string;
    content?: ReviewCardContent;
    error?: string;
  }>();
  const [reload, setReload] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editDraft, setEditDraft] = useState<ReviewCardDraft>();
  const [preview, setPreview] = useState<Card[]>();
  const [previewIndex, setPreviewIndex] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const mutation = useRef(false);
  const [lastAction, setLastAction] = useState<{
    progress: SessionProgress;
    undo: ReviewUndoToken | ReviewDeleteUndoToken | ScratchUndo;
    kind: "grade" | "delete";
  }>();
  const [revealed, setRevealed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(loadFailure);
  const [pinned, setPinned] = useState(true);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionIndex, setActionIndex] = useState(0);
  const loadingReview = screen === "review" && preferences.root !== null && !reviewLoaded;
  const queuedCard = (
    preferences.root ? workspaceCards : (cards as readonly (Card | WorkspaceCard)[])
  ).find((card) => card.id === queue[0]);
  const loadingCard =
    screen === "review" && !!preferences.root && !!queuedCard && loadedCard?.id !== queuedCard.id;
  const busy = saving || loadingReview || loadingCard;
  const current =
    queuedCard && loadedCard?.id === queuedCard.id && loadedCard.content
      ? {
          ...queuedCard,
          question: loadedCard.content.prompt,
          answer: loadedCard.content.reveal,
          cardType: loadedCard.content.cardType,
        }
      : queuedCard;
  const cardError = loadedCard?.id === current?.id ? loadedCard?.error : undefined;
  useEffect(() => {
    if (!preferences.root || !queuedCard || !("reference" in queuedCard) || screen !== "review")
      return;
    setLoadedCard(undefined);
    setRevealed(false);
    return onSettled(readReviewCard(preferences.root, queuedCard), (result) => {
      setLoadedCard(
        result.ok
          ? { id: queuedCard.id, content: result.value }
          : { id: queuedCard.id, error: result.error },
      );
    });
  }, [preferences.root, queuedCard?.id, reload, screen]);
  const currentDeckPath =
    current && isWorkspaceCard(current) ? current.reference.deckPath : undefined;
  const currentDeckName = currentDeckPath
    ? (decks.find((deck) => deck.absolutePath === currentDeckPath)?.name ??
      basename(currentDeckPath, ".md"))
    : "Pocket (scratch deck)";

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    panel.setStatus(statusMenu(null));
    const refresh = async () => {
      try {
        const result = preferences.root
          ? await loadReviewStatus(preferences.root)
          : loadFailure
            ? { ok: false as const, error: loadFailure.text }
            : {
                ok: true as const,
                value: {
                  due: 0,
                  new: cards.filter((card) => !card.lastGrade).length,
                  total: cards.length,
                  unavailableDecks: 0,
                },
              };
        if (!cancelled) panel.setStatus(statusMenu(result, !preferences.root));
      } catch (error) {
        if (!cancelled) panel.setStatus(statusMenu({ ok: false, error: toErrorMessage(error) }));
      }
      // Schedule after completion to avoid overlapping background scans.
      if (!cancelled) timer = setTimeout(refresh, 60_000);
    };
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [preferences.root, cards, statusRevision]);

  function updatePreferences(patch: Partial<Preferences>) {
    const next = { ...preferences, ...patch };
    try {
      savePreferences(next);
      setPreferences(next);
      return true;
    } catch (error) {
      setNotice(failure(`Could not save preferences: ${toErrorMessage(error)}`));
      return false;
    }
  }
  useEffect(() => {
    if (!preferences.root) return;
    return onSettled(listDecks(preferences.root), (result) => {
      if (result.ok) setDecks(result.value);
      else setNotice(failure(result.error));
    });
  }, [preferences.root]);
  useEffect(() => {
    const root = preferences.root;
    if (!root || !loadingReview) return;
    setStartError(undefined);
    setIssues([]);
    setWorkspaceCards([]);
    setQueue([]);
    setLoadedCard(undefined);
    setLastAction(undefined);
    return onSettled(loadReview(root), (result) => {
      setReviewLoaded(true);
      if (!result.ok) {
        setStartError(result.error);
        return;
      }
      setWorkspaceCards(result.value.cards);
      setIssues(result.value.issues);
      setLastAction(undefined);
      setQueue(result.value.cards.map((card) => card.id));
      setRevealed(false);
    });
  }, [preferences.root, loadingReview]);

  function commit(next: Card[]) {
    if (loadFailure) {
      setNotice(loadFailure);
      return false;
    }
    try {
      saveCards(next);
      setCards(next);
      return true;
    } catch (error) {
      setNotice(failure(`Could not save: ${toErrorMessage(error)}`));
      return false;
    }
  }
  const input = () => ({
    cardType: preferences.cardType,
    deckPath: preferences.deck,
    question,
    answer,
    content: cloze,
  });
  function checkDraft() {
    const result = previewDraft(input());
    if (!result.ok) {
      setFieldErrors({ [result.field]: result.error });
      setNotice(failure(result.error));
      return null;
    }
    if (
      preferences.deck !== "scratch" &&
      !decks.some((deck) => deck.absolutePath === preferences.deck)
    ) {
      setFieldErrors({ deckPath: "Choose a deck from the current folder." });
      return null;
    }
    setFieldErrors({});
    return result.value;
  }
  async function create() {
    if (busy || mutation.current) return;
    const prepared = checkDraft();
    if (!prepared) return;
    mutation.current = true;
    setSaving(true);
    try {
      if (preferences.deck === "scratch") {
        const scratch = prepareScratch(
          preferences.cardType === "qa"
            ? { type: "qa", question, answer }
            : { type: "cloze", content: cloze },
        );
        if (!scratch.ok) {
          setNotice(failure(scratch.error));
          return;
        }
        const next = scratch.value;
        if (!commit([...cards, ...next])) return;
        if (!preferences.root) setQueue([...queue, ...next.map((card) => card.id)]);
      } else {
        const result = await createWorkspaceCard(input());
        if (result._tag !== "Created") {
          setNotice(failure(result.message));
          if (result._tag === "FieldError") {
            setFieldErrors({ [result.field]: result.message });
            setPreview(undefined);
          }
          return;
        }
        setReviewLoaded(false);
      }
      setLastAction(undefined);
      setQuestion("");
      setAnswer("");
      setCloze("");
      setPreview(undefined);
      imageTarget.current = preferences.cardType === "qa" ? "question" : "content";
      setEditorKey((key) => key + 1);
      setFocus(preferences.cardType === "qa" ? "question" : "content");
      setNotice(
        success(prepared.length === 1 ? "Card created" : `${prepared.length} cards created`),
      );
      setStatusRevision((revision) => revision + 1);
      if (preferences.closeAfterSubmit) panel.hide();
    } catch (error) {
      setNotice(failure(toErrorMessage(error)));
    } finally {
      mutation.current = false;
      setSaving(false);
    }
  }
  async function grade(lastGrade: ReviewGrade) {
    if (!current || !revealed || busy || cardError || mutation.current || confirmingDelete) return;
    mutation.current = true;
    setSaving(true);
    try {
      let undo: ReviewUndoToken | ScratchUndo = {
        kind: "scratchGrade",
        cardId: current.id,
        lastGrade: current.lastGrade,
      };
      if (isWorkspaceCard(current)) {
        const result = await gradeInDeck(current, lastGrade);
        if (!result.ok) {
          setNotice(failure(result.error));
          return;
        }
        undo = result.value;
      } else if (
        !commit(cards.map((card) => (card.id === current.id ? { ...card, lastGrade } : card)))
      )
        return;
      setLastAction({ kind: "grade", progress, undo });
      setProgress(gradeSession(progress, lastGrade));
      setRevealed(false);
      setNotice(null);
      setStatusRevision((revision) => revision + 1);
    } catch (error) {
      setNotice(failure(toErrorMessage(error)));
    } finally {
      mutation.current = false;
      setSaving(false);
    }
  }
  async function undo() {
    if (!lastAction || mutation.current || saving || confirmingDelete) return;
    mutation.current = true;
    setSaving(true);
    try {
      if ("kind" in lastAction.undo) {
        const scratch = lastAction.undo;
        if (scratch.kind === "scratchGrade") {
          if (
            !commit(
              cards.map((card) =>
                card.id === scratch.cardId ? { ...card, lastGrade: scratch.lastGrade } : card,
              ),
            )
          )
            return;
        } else {
          const restored = [...cards];
          for (const entry of scratch.entries)
            restored.splice(Math.min(entry.index, restored.length), 0, entry.card);
          if (!commit(restored)) return;
        }
      } else {
        const result =
          "removed" in lastAction.undo
            ? await restoreReviewItem(lastAction.undo)
            : await undoReviewGrade(lastAction.undo);
        if (!result.ok) {
          setNotice(failure(result.error));
          return;
        }
      }
      setProgress(lastAction.progress);
      setLastAction(undefined);
      setLoadedCard(undefined);
      setReload((value) => value + 1);
      setRevealed(false);
      setNotice(null);
      setStatusRevision((value) => value + 1);
    } catch (error) {
      setNotice(failure(toErrorMessage(error)));
    } finally {
      mutation.current = false;
      setSaving(false);
    }
  }
  function requestDelete() {
    if (!current || busy || cardError || mutation.current) return;
    setActionsOpen(false);
    setConfirmingDelete(true);
  }
  async function deleteCurrent() {
    if (!current || busy || cardError || mutation.current) return;
    const ids = isWorkspaceCard(current)
      ? (loadedCard?.content?.sourceCardIds ?? [])
      : current.source
        ? cards
            .filter((card) => card.source?.noteId === current.source!.noteId)
            .map((card) => card.id)
        : [current.id];
    setConfirmingDelete(false);
    mutation.current = true;
    setSaving(true);
    try {
      let undo: ReviewDeleteUndoToken | ScratchUndo = {
        kind: "scratchDelete",
        entries: cards.flatMap((card, index) => (ids.includes(card.id) ? [{ index, card }] : [])),
      };
      let removedIds = ids;
      if (isWorkspaceCard(current)) {
        const result = await deleteReviewItem(current);
        if (!result.ok) {
          setNotice(failure(result.error));
          return;
        }
        undo = result.value;
        removedIds = workspaceCards
          .filter(
            (card) =>
              card.reference.deckPath === current.reference.deckPath &&
              ids.includes(card.reference.cardId),
          )
          .map((card) => card.id);
      } else if (!commit(cards.filter((card) => !ids.includes(card.id)))) return;
      setLastAction({ kind: "delete", progress, undo });
      setProgress(removeSessionCards(progress, removedIds));
      setRevealed(false);
      setNotice(null);
      setStatusRevision((value) => value + 1);
    } catch (error) {
      setNotice(failure(toErrorMessage(error)));
    } finally {
      mutation.current = false;
      setSaving(false);
    }
  }
  function openEditor() {
    if (!current || busy || cardError || confirmingDelete) return;
    const draft =
      loadedCard?.content?.draft ??
      current.source?.draft ??
      (current.cardType !== "cloze"
        ? { cardType: "qa" as const, question: current.question, answer: current.answer }
        : undefined);
    if (!draft) {
      setNotice(
        failure("This legacy scratch cloze has no source note. Open its data file to edit it."),
      );
      return;
    }
    setEditDraft(draft);
    setFieldErrors({});
    setActionsOpen(false);
  }
  async function saveEdit() {
    if (!current || !editDraft || mutation.current) return;
    mutation.current = true;
    setSaving(true);
    try {
      if (isWorkspaceCard(current)) {
        const result = await saveReviewEdit(current, editDraft);
        if (!result.ok) {
          setNotice(failure(result.error));
          if (result.field) setFieldErrors({ [result.field]: result.error });
          return;
        }
      } else {
        const prepared = prepareScratch(
          editDraft.cardType === "qa"
            ? { type: "qa", question: editDraft.question, answer: editDraft.answer }
            : { type: "cloze", content: editDraft.content },
        );
        if (!prepared.ok) {
          setNotice(failure(prepared.error));
          return;
        }
        const siblings = current.source
          ? cards.filter((card) => card.source?.noteId === current.source!.noteId)
          : [current];
        if (
          prepared.value.length !== siblings.length ||
          (current.source &&
            siblings.some(
              (card) =>
                !prepared.value.some((next) => next.source?.cardKey === card.source?.cardKey),
            ))
        ) {
          setFieldErrors({
            content: "Editing cannot add, remove, or renumber cloze indices during a review.",
          });
          return;
        }
        if (
          !commit(
            cards.map((card) => {
              if (!siblings.some((sibling) => sibling.id === card.id)) return card;
              const next = current.source
                ? prepared.value.find((next) => next.source?.cardKey === card.source?.cardKey)!
                : prepared.value[0]!;
              return {
                ...card,
                question: next.question,
                answer: next.answer,
                source: card.source ? { ...card.source, draft: editDraft } : next.source,
              };
            }),
          )
        )
          return;
      }
      setEditDraft(undefined);
      setFieldErrors({});
      setRevealed(false);
      setLoadedCard(undefined);
      setReload((value) => value + 1);
      setNotice(success("Card updated"));
    } catch (error) {
      setNotice(failure(toErrorMessage(error)));
    } finally {
      mutation.current = false;
      setSaving(false);
    }
  }
  function openDeck() {
    if (!current) return;
    execFile("/usr/bin/open", [currentDeckPath ?? cardsPath], (error) => {
      if (error) setNotice(failure(error.message));
    });
  }
  async function refreshDecks() {
    if (busy || !preferences.root) return;
    setSaving(true);
    try {
      const result = await listDecks(preferences.root);
      if (result.ok) {
        setDecks(result.value);
        setNotice(success("Decks refreshed"));
      } else setNotice(failure(result.error));
    } catch (error) {
      setNotice(failure(toErrorMessage(error)));
    } finally {
      setSaving(false);
    }
  }
  function openPreview() {
    if (busy) return;
    if (preview) {
      setPreview(undefined);
      return;
    }
    const prepared = checkDraft();
    if (!prepared) return;
    setPreview(
      prepared.map((spec) => ({ id: spec.key, question: spec.prompt, answer: spec.reveal })),
    );
    setPreviewIndex(0);
    setActionsOpen(false);
  }
  function insertCloze() {
    if (busy || preferences.cardType !== "cloze" || preview) return;
    setCloze(appendNextClozeTemplate(cloze));
    setFieldErrors({});
    setFocus("content");
  }
  const imageTarget = useRef("question");
  async function insertImage() {
    if (busy || mutation.current || preview) return;
    if (!preferences.root || preferences.deck === "scratch") {
      setFieldErrors({ deckPath: "Choose a workspace deck before inserting an image." });
      return;
    }
    const target = preferences.cardType === "cloze" ? "content" : imageTarget.current;
    mutation.current = true;
    setSaving(true);
    try {
      const result = await insertClipboardImage(
        preferences.root,
        preferences.deck,
        target === "question" ? question : target === "answer" ? answer : cloze,
      );
      if (result._tag === "Inserted") {
        (target === "question" ? setQuestion : target === "answer" ? setAnswer : setCloze)(
          result.content,
        );
        setFocus(target);
        setFieldErrors({});
        setNotice(success("Image inserted"));
      } else setNotice(failure(result.message));
    } catch (error) {
      setNotice(failure(toErrorMessage(error)));
    } finally {
      mutation.current = false;
      setSaving(false);
    }
  }
  function primary() {
    if (busy || confirmingDelete) return;
    if (editDraft) void saveEdit();
    else if (screen === "create") create();
    else if (!current) panel.hide();
    else if (revealed) grade("good");
    else if (!cardError) setRevealed(true);
  }
  function togglePin() {
    panel.pin(!pinned);
    setPinned(!pinned);
    setActionsOpen(false);
  }
  const clearFieldError = (field: string) =>
    setFieldErrors((errors) => {
      if (!errors[field]) return errors;
      const next = { ...errors };
      delete next[field];
      return next;
    });
  const edit =
    (field: "question" | "answer" | "content", set: (value: string) => void) => (value: string) => {
      imageTarget.current = field;
      setFocus(field);
      set(value);
      setNotice(null);
      clearFieldError(field);
    };
  const draftField = (name: "question" | "answer" | "content") => ({
    focused: focus === name,
    error: fieldErrors[name],
    readOnly: saving,
    onFocus: () => {
      setFocus(name);
      imageTarget.current = name;
    },
    onBlur: () => setFocus((current) => (current === name ? "" : current)),
  });
  const restart = () => {
    if (busy || mutation.current) return;
    setLastAction(undefined);
    setEditDraft(undefined);
    setLoadedCard(undefined);
    if (preferences.root) setReviewLoaded(false);
    else setQueue(cards.map((card) => card.id));
    setRevealed(false);
    setActionsOpen(false);
    setNotice(null);
  };
  const menu = [
    ...(editDraft
      ? [
          { label: "Save Changes", key: "⌘ ↵", run: () => void saveEdit() },
          {
            label: "Discard Changes",
            key: "Esc",
            run: () => {
              if (!saving) {
                setEditDraft(undefined);
                setFieldErrors({});
              }
            },
          },
        ]
      : screen === "create"
        ? [
            { label: preview ? "Edit Card" : "Preview Card", key: "⌘ P", run: openPreview },
            ...(!preview
              ? [
                  ...(preferences.cardType === "cloze"
                    ? [{ label: "Insert Cloze Template", key: "⌘ ⇧ C", run: insertCloze }]
                    : []),
                  {
                    label: "Insert Image from Clipboard",
                    key: "⌘ I",
                    run: () => void insertImage(),
                  },
                  { label: "Refresh Decks", key: "⌘ R", run: () => void refreshDecks() },
                ]
              : []),
            {
              label: preferences.closeAfterSubmit
                ? "Keep Open After Creating"
                : "Close After Creating",
              key: "",
              run: () => updatePreferences({ closeAfterSubmit: !preferences.closeAfterSubmit }),
            },
          ]
        : [
            ...(lastAction
              ? [
                  {
                    label: lastAction.kind === "grade" ? "Undo Last Review" : "Undo Delete",
                    key: "⌘ Z",
                    run: () => void undo(),
                  },
                ]
              : []),
            ...(current && !cardError
              ? [
                  {
                    label: current.cardType === "cloze" ? "Edit Cloze Note" : "Edit Card",
                    key: "⌘ E",
                    run: openEditor,
                  },
                  {
                    label: current.cardType === "cloze" ? "Delete Cloze Note" : "Delete Card",
                    key: "⌘ ⌫",
                    run: requestDelete,
                  },
                ]
              : []),
            ...(current
              ? [
                  {
                    label: currentDeckPath ? "Open Deck" : "Open Scratch Data",
                    key: "⌘ O",
                    run: openDeck,
                  },
                ]
              : []),
            ...(cardError
              ? [
                  { label: "Retry Card", key: "⌘ R", run: () => setReload((value) => value + 1) },
                  {
                    label: "Skip Card",
                    key: "",
                    run: () => {
                      setProgress({ ...progress, queue: queue.slice(1) });
                      setRevealed(false);
                    },
                  },
                ]
              : []),
          ]),
    { label: "Choose Workspace…", key: "", run: () => events.preferences() },
    { label: pinned ? "Stop Keeping on Top" : "Keep on Top", key: "⌘ ⇧ P", run: togglePin },
    ...(screen === "review" && !editDraft
      ? [
          {
            label: "Restart Review",
            key: "",
            run: restart,
          },
        ]
      : []),
    { label: "Close Window", key: "Esc", run: panel.hide },
    {
      label: "Quit",
      key: "⌘ Q",
      run: () => {
        onQuit();
      },
    },
  ];
  useEffect(() => {
    events.refresh = () => setStatusRevision((revision) => revision + 1);
    events.preferences = () => {
      if (busy || mutation.current) return;
      const root = panel.chooseWorkspace();
      if (!root) return;
      if (!updatePreferences({ root, deck: "scratch" })) return;
      setLastAction(undefined);
      setEditDraft(undefined);
      setPreview(undefined);
      setFieldErrors({});
      setIssues([]);
      setDecks([]);
      setWorkspaceCards([]);
      setQueue([]);
      setReviewLoaded(false);
      setRevealed(false);
    };
    events.route = (next) => {
      if (mutation.current) return;
      if (next === "review" && queue.length === 0 && !busy && !lastAction) {
        if (preferences.root) setReviewLoaded(false);
        else setQueue(cards.map((card) => card.id));
      }
      setConfirmingDelete(false);
      setEditDraft(undefined);
      setFieldErrors({});
      setScreen(next);
      setActionsOpen(false);
      setOpenSelect(null);
      setNotice(loadFailure);
    };
    events.key = (event) => {
      const cmd = event.modifiers?.cmd;
      if (confirmingDelete) {
        if (event.key === "escape") setConfirmingDelete(false);
        else if (cmd && event.key === "enter") void deleteCurrent();
        return;
      }
      if (openSelect) return;
      if (cmd && event.key !== "k" && actionsOpen) setActionsOpen(false);
      if (event.key === "escape") {
        if (actionsOpen) setActionsOpen(false);
        else if (editDraft && !saving) {
          setEditDraft(undefined);
          setFieldErrors({});
        } else if (preview) setPreview(undefined);
        else panel.hide();
      } else if (cmd && event.key === "k") {
        setActionsOpen(!actionsOpen);
        setActionIndex(0);
      } else if (cmd && event.key === "p" && event.modifiers?.shift) togglePin();
      else if (editDraft && cmd && event.key === "enter") void saveEdit();
      else if (cmd && event.key === "p" && screen === "create" && !editDraft) openPreview();
      else if (cmd && event.key === "i" && screen === "create" && !editDraft) void insertImage();
      else if (
        cmd &&
        event.modifiers?.shift &&
        event.key === "c" &&
        screen === "create" &&
        !editDraft
      )
        insertCloze();
      else if (cmd && event.key === "r" && !editDraft) {
        if (screen === "create") void refreshDecks();
        else if (cardError) setReload((value) => value + 1);
        else restart();
      } else if (screen === "review" && !editDraft && cmd && event.key === "z") void undo();
      else if (screen === "review" && !editDraft && cmd && event.key === "e") openEditor();
      else if (screen === "review" && !editDraft && cmd && event.key === "o") openDeck();
      else if (screen === "review" && !editDraft && cmd && event.key === "backspace")
        requestDelete();
      else if (preview && event.modifiers?.alt && event.key === "right")
        setPreviewIndex((index) => Math.min(preview.length - 1, index + 1));
      else if (preview && event.modifiers?.alt && event.key === "left")
        setPreviewIndex((index) => Math.max(0, index - 1));
      else if (actionsOpen) {
        if (event.key === "down") setActionIndex((actionIndex + 1) % menu.length);
        else if (event.key === "up") setActionIndex((actionIndex + menu.length - 1) % menu.length);
        else if (event.key === "enter") {
          menu[actionIndex]?.run();
          setActionsOpen(false);
        }
      } else if (
        (screen === "create" || editDraft) &&
        event.key === "tab" &&
        !cmd &&
        !event.modifiers?.ctrl &&
        !event.modifiers?.alt
      ) {
        if (event.modifiers?.shift) renderer.focusPrevious();
        else renderer.focusNext();
      } else if (screen === "create" && cmd && event.key === "enter") primary();
      else if (screen === "review" && !editDraft) {
        const action = reviewKey(event, revealed);
        if (action === "reveal") primary();
        else if (action) void grade(action);
      }
    };
  });
  useEffect(() => {
    if (notice?.tone !== "success") return;
    const timer = setTimeout(() => setNotice(null), 1800);
    return () => clearTimeout(timer);
  }, [notice]);

  const primaryLabel = busy
    ? "Working…"
    : editDraft
      ? "Save Changes"
      : screen === "create"
        ? "Create Card"
        : !current
          ? "Close"
          : revealed
            ? "Good"
            : "Show Answer";

  return (
    <div
      style={{
        ...column,
        height: "100%",
        backgroundColor: "#282828c8",
        position: "relative",
      }}
    >
      <div
        style={{
          ...row,
          height: 44,
          flexShrink: 0,
          paddingLeft: 15,
          paddingRight: 18,
          justifyContent: "space-between",
        }}
      >
        <div
          onClick={() => {
            if (editDraft && !saving) {
              setEditDraft(undefined);
              setFieldErrors({});
            } else if (preview) setPreview(undefined);
            else panel.hide();
          }}
          style={{ cursor: "pointer", padding: 5 }}
        >
          <text style={{ color: colors.muted, fontSize: 24 }}>‹</text>
        </div>
        {screen === "review" && (current || lastAction) && (
          <text
            style={{ color: colors.muted, fontSize: 12 }}
          >{`${progress.grades.length} reviewed · ${queue.length} remaining${lastAction ? " · ⌘Z Undo" : ""}`}</text>
        )}
      </div>
      {editDraft ? (
        <div
          style={{
            ...column,
            flexGrow: 1,
            minHeight: 0,
            overflowY: "scroll",
            padding: 30,
            gap: 16,
          }}
        >
          <text style={{ color: colors.text, fontSize: 18 }}>
            {`Edit ${editDraft.cardType === "cloze" ? "Cloze Note" : "Card"}`}
          </text>
          {editDraft.cardType === "qa" ? (
            <>
              <DraftField
                label="Question"
                testId="edit-question"
                value={editDraft.question}
                placeholder="Question"
                rows={3}
                autoFocus
                {...draftField("question")}
                onChange={(question) => {
                  setEditDraft({ ...editDraft, question });
                  clearFieldError("question");
                }}
              />
              <DraftField
                label="Answer"
                testId="edit-answer"
                value={editDraft.answer}
                placeholder="Answer"
                rows={3}
                {...draftField("answer")}
                onChange={(answer) => {
                  setEditDraft({ ...editDraft, answer });
                  clearFieldError("answer");
                }}
              />
            </>
          ) : (
            <DraftField
              label="Content"
              testId="edit-content"
              value={editDraft.content}
              placeholder="Cloze note"
              rows={6}
              autoFocus
              {...draftField("content")}
              onChange={(content) => {
                setEditDraft({ ...editDraft, content });
                clearFieldError("content");
              }}
            />
          )}
          <Action
            label="Discard Changes"
            keys="Esc"
            onClick={() => {
              if (!saving) {
                setEditDraft(undefined);
                setFieldErrors({});
              }
            }}
          />
        </div>
      ) : screen === "create" && preview ? (
        <div
          style={{
            ...column,
            flexGrow: 1,
            minHeight: 0,
            overflowY: "scroll",
            padding: 30,
            gap: 16,
          }}
        >
          <text style={{ color: colors.muted, fontSize: 13 }}>
            {`Card Preview ${previewIndex + 1}/${preview.length}`}
          </text>
          <CardMarkdown
            source={preview[previewIndex]!.question}
            deckPath={preferences.deck === "scratch" ? undefined : preferences.deck}
          />
          <div style={{ height: 1, backgroundColor: colors.line }} />
          <CardMarkdown
            source={preview[previewIndex]!.answer}
            deckPath={preferences.deck === "scratch" ? undefined : preferences.deck}
          />
          <div style={row}>
            <Action label="Edit Card" keys="⌘ P" onClick={openPreview} />
            {previewIndex > 0 && (
              <Action
                label="Previous"
                keys="⌥ ←"
                onClick={() => setPreviewIndex(previewIndex - 1)}
              />
            )}
            {previewIndex < preview.length - 1 && (
              <Action label="Next" keys="⌥ →" onClick={() => setPreviewIndex(previewIndex + 1)} />
            )}
          </div>
        </div>
      ) : screen === "create" ? (
        <div
          key={editorKey}
          style={{
            ...column,
            minHeight: 0,
            overflowY: "scroll",
            flexGrow: 1,
            paddingLeft: 70,
            paddingRight: 70,
            paddingTop: 9,
            gap: 17,
          }}
        >
          <Field label="Deck" error={fieldErrors.deckPath}>
            <DeckCombobox
              value={preferences.deck}
              open={openSelect === "deck"}
              onOpenChange={(open) => setOpenSelect(open ? "deck" : null)}
              options={[
                ...decks.map((deck) => ({ value: deck.absolutePath, label: deck.name })),
                { value: "scratch", label: "Pocket (scratch deck)" },
              ]}
              onChange={(deck) => {
                if (!saving) {
                  updatePreferences({ deck });
                  setFieldErrors({});
                }
              }}
            />
          </Field>
          <Field label="Card Type">
            <Dropdown
              testId="type-select"
              value={preferences.cardType}
              open={openSelect === "type"}
              onOpenChange={(open) => setOpenSelect(open ? "type" : null)}
              options={[
                { value: "qa", label: "Question and Answer" },
                { value: "cloze", label: "Cloze" },
              ]}
              onChange={(type) => {
                if (!saving) {
                  updatePreferences({ cardType: type === "cloze" ? "cloze" : "qa" });
                  setFieldErrors({});
                }
              }}
            />
          </Field>
          <div style={{ height: 1, backgroundColor: colors.line }} />
          {preferences.cardType === "qa" ? (
            <>
              <DraftField
                label="Question"
                testId="question"
                autoFocus={imageTarget.current !== "answer"}
                value={question}
                onChange={edit("question", setQuestion)}
                placeholder="What do you want to remember?"
                rows={2}
                {...draftField("question")}
              />
              <DraftField
                label="Answer"
                testId="answer"
                autoFocus={imageTarget.current === "answer"}
                value={answer}
                onChange={edit("answer", setAnswer)}
                placeholder="The answer"
                rows={2}
                {...draftField("answer")}
              />
            </>
          ) : (
            <DraftField
              label="Content"
              testId="cloze-content"
              autoFocus
              value={cloze}
              onChange={edit("content", setCloze)}
              placeholder="The {{c1::answer}} in context."
              rows={5}
              {...draftField("content")}
            />
          )}
        </div>
      ) : (
        <div
          key={current?.id ?? "empty-review"}
          style={{
            ...column,
            flexGrow: 1,
            minHeight: 0,
            overflowY: "scroll",
          }}
        >
          <div
            style={{
              ...column,
              flexShrink: 0,
              flexGrow: current ? 0 : 1,
              paddingLeft: 38,
              paddingRight: 38,
              paddingBottom: 24,
              paddingTop: 16,
              gap: 16,
            }}
          >
            {startError ? (
              <div style={{ ...column, gap: 12 }}>
                <text style={{ color: colors.error, fontSize: 18 }}>Could not start review</text>
                <text style={{ color: colors.muted }}>{startError}</text>
                <Action label="Retry" keys="⌘ R" onClick={restart} />
                <Action label="Choose Workspace…" onClick={() => events.preferences()} />
              </div>
            ) : loadingCard ? (
              <text style={{ color: colors.muted }}>Loading card…</text>
            ) : cardError ? (
              <div style={{ ...column, gap: 12 }}>
                <text
                  style={{ color: colors.error }}
                >{`Could not load this card: ${cardError}`}</text>
                <text style={{ color: colors.muted }}>{currentDeckPath}</text>
                <Action
                  label="Retry Card"
                  keys="⌘ R"
                  onClick={() => setReload((value) => value + 1)}
                />
                <Action
                  label="Skip Card"
                  onClick={() => {
                    setProgress({ ...progress, queue: queue.slice(1) });
                    setRevealed(false);
                  }}
                />
                <Action label="Open Deck" keys="⌘ O" onClick={openDeck} />
              </div>
            ) : current ? (
              <>
                <CardMarkdown
                  testId={revealed && current.cardType === "cloze" ? "revealed-answer" : "prompt"}
                  source={
                    revealed && current.cardType === "cloze" ? current.answer : current.question
                  }
                  deckPath={currentDeckPath}
                />
                {revealed && current.cardType !== "cloze" && (
                  <>
                    <div style={{ height: 1, backgroundColor: colors.line }} />
                    <CardMarkdown
                      testId="revealed-answer"
                      source={current.answer}
                      deckPath={currentDeckPath}
                    />
                  </>
                )}
              </>
            ) : (
              <div
                style={{
                  ...column,
                  flexGrow: 1,
                  justifyContent: "center",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <text style={{ color: colors.text, fontSize: 19 }}>
                  {busy
                    ? "Loading cards…"
                    : progress.grades.length || lastAction
                      ? "Review complete"
                      : "No cards due"}
                </text>
                <text style={{ color: colors.muted, fontSize: 13 }}>
                  {busy
                    ? ""
                    : progress.grades.length || lastAction
                      ? `Reviewed ${progress.grades.length} ${progress.grades.length === 1 ? "card" : "cards"}. Again: ${progress.grades.filter((g) => g === "again").length} · Hard: ${progress.grades.filter((g) => g === "hard").length} · Good: ${progress.grades.filter((g) => g === "good").length} · Easy: ${progress.grades.filter((g) => g === "easy").length}`
                      : "There are no reviewable new or due cards."}
                </text>
              </div>
            )}
            {!current && !busy && !startError && (
              <Action label="Start New Session" keys="⌘ R" onClick={restart} />
            )}
            {issues.length > 0 && (
              <div style={{ ...column, gap: 8 }}>
                <text style={{ color: colors.error }}>Some decks or cards were excluded:</text>
                {issues.map((issue, index) => (
                  <text key={index} style={{ color: colors.muted, fontSize: 12 }}>
                    {`${issue.relativePath}: ${issue.message}`}
                  </text>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {notice && (
        <div style={{ paddingLeft: 20, paddingRight: 20, paddingBottom: 8 }}>
          <text
            style={{ color: notice.tone === "success" ? colors.muted : colors.error, fontSize: 12 }}
          >
            {notice.text}
          </text>
        </div>
      )}
      <div
        style={{
          ...row,
          justifyContent: "space-between",
          height: 43,
          flexShrink: 0,
          paddingLeft: 16,
          paddingRight: 12,
          borderTopWidth: 1,
          borderColor: colors.line,
          backgroundColor: "#00000012",
        }}
      >
        <text
          style={{
            color: colors.muted,
            fontSize: 12,
            flexShrink: 1,
            minWidth: 0,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {screen === "create" ? "Create Card" : current ? currentDeckName : "Review Cards"}
        </text>
        <div style={{ ...row, gap: 8 }}>
          {screen === "review" && !editDraft && revealed && current && !cardError && (
            <>
              <Action label="Again" keys="1" onClick={() => grade("again")} testId="again" />
              <Action label="Hard" keys="2" onClick={() => grade("hard")} testId="hard" />
            </>
          )}
          <Action
            label={primaryLabel}
            keys={editDraft || screen === "create" ? "⌘ ↵" : revealed ? "Space / 3" : "Space"}
            primary
            onClick={primary}
            testId="primary"
          />
          {screen === "review" && !editDraft && revealed && current && !cardError && (
            <Action label="Easy" keys="4" onClick={() => grade("easy")} testId="easy" />
          )}
          <div style={{ width: 1, height: 16, backgroundColor: colors.line }} />
          <Action
            label="Actions"
            keys="⌘ K"
            onClick={() => {
              if (confirmingDelete) return;
              setActionsOpen(!actionsOpen);
              setActionIndex(0);
            }}
            testId="actions"
          />
        </div>
      </div>
      {confirmingDelete && current && (
        <div
          style={{
            ...column,
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundColor: "#00000088",
            justifyContent: "center",
            alignItems: "center",
          }}
          onClick={() => {}}
        >
          <div
            style={{ ...menuSurface, ...column, width: 400, maxWidth: "90%", padding: 24, gap: 16 }}
          >
            <text style={{ color: colors.text, fontSize: 18 }}>
              {current.cardType === "cloze" ? "Delete Cloze Note?" : "Delete Card?"}
            </text>
            <text style={{ color: colors.muted, fontSize: 14 }}>
              {current.cardType === "cloze"
                ? `This removes the note and all ${loadedCard?.content?.sourceCardIds.length ?? (current.source ? cards.filter((card) => card.source?.noteId === current.source!.noteId).length : 1)} cards it creates.`
                : "This removes the card from its deck."}
            </text>
            <text style={{ color: colors.muted, fontSize: 14 }}>
              You can undo this during the current review session.
            </text>
            <div style={{ ...row, justifyContent: "flex-end", gap: 12 }}>
              <Action
                label="Cancel"
                keys="Esc"
                testId="cancel-delete"
                onClick={() => setConfirmingDelete(false)}
              />
              <Action
                label="Delete"
                keys="⌘ ↵"
                testId="confirm-delete"
                onClick={() => void deleteCurrent()}
              />
            </div>
          </div>
        </div>
      )}
      {actionsOpen && (
        <div
          style={{
            ...menuSurface,
            position: "absolute",
            bottom: 49,
            right: 12,
            width: 285,
            maxHeight: 350,
            overflowY: "scroll",
            padding: 6,
            gap: 2,
            borderRadius: 10,
            boxShadow: {
              offsetX: 0,
              offsetY: 6,
              blurRadius: 24,
              spreadRadius: 0,
              color: "#00000060",
            },
          }}
        >
          {menu.map((item, index) => (
            <div
              key={item.label}
              onClick={() => {
                item.run();
                setActionsOpen(false);
              }}
              onMouseEnter={() => setActionIndex(index)}
              style={{ ...menuItem(actionIndex === index), justifyContent: "space-between" }}
            >
              <text style={{ color: colors.text, fontSize: 13 }}>{item.label}</text>
              {item.key && <Key>{item.key}</Key>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
