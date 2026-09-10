import { execFile } from "node:child_process";
import { basename } from "node:path";
import { useEffect, useRef, useState } from "react";
import { createRenderer, type EventPayload } from "@gpuix/react";
import { appendNextClozeTemplate } from "@simbyotic/re/study";
import type {
  ReviewCardContent,
  ReviewUndoToken,
  ReviewDeleteUndoToken,
  ReviewCardDraft,
  ReviewDeckIssue,
} from "@simbyotic/re/study";
import type { DeckEntry } from "@simbyotic/re/workspace";
import { saveCards, type Card } from "./cards";
import { toErrorMessage } from "./error-message";
import { type Screen } from "./launch";
import { failure, success, type Notice } from "./notice";
import { onSettled } from "./on-settled";
import { panel } from "./panel";
import { savePreferences, type Preferences } from "./preferences";
import { reviewKey, type ReviewGrade } from "./review-controls";
import { gradeSession, removeSessionCards, type SessionProgress } from "./review-session";
import { statusMenu } from "./review-status";
import { ActionsMenu, type MenuItem } from "./screens/actions-menu";
import { CreateScreen } from "./screens/create-screen";
import { DeleteDialog } from "./screens/delete-dialog";
import { EditScreen } from "./screens/edit-screen";
import { PreviewScreen } from "./screens/preview-screen";
import { ReviewScreen, type ReviewView } from "./screens/review-screen";
import { Shell } from "./screens/shell";
import { cardsPath } from "./storage";
import type { DraftFieldName, DraftFieldState } from "./ui/field";
import {
  createWorkspaceCard,
  deleteReviewItem,
  gradeInDeck,
  insertClipboardImage,
  listDecks,
  loadReview,
  loadReviewStatus,
  prepareScratch,
  previewDraft,
  readReviewCard,
  restoreReviewItem,
  saveReviewEdit,
  undoReviewGrade,
  type WorkspaceCard,
} from "./workspace";

const isWorkspaceCard = (card: Card | WorkspaceCard): card is WorkspaceCard => "reference" in card;

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
    : "Overlay (scratch deck)";

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
  // Every persisting operation holds the mutation lock and the saving flag for
  // its whole duration; an early return or a thrown error must release both.
  async function mutate(run: () => Promise<void>) {
    mutation.current = true;
    setSaving(true);
    try {
      await run();
    } catch (error) {
      setNotice(failure(toErrorMessage(error)));
    } finally {
      mutation.current = false;
      setSaving(false);
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
    await mutate(async () => {
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
        if (result._tag === "FieldError") {
          setFieldErrors({ [result.field]: result.message });
          setPreview(undefined);
          return;
        }
        if (result._tag !== "Created") {
          setNotice(failure(result.message));
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
    });
  }
  async function grade(lastGrade: ReviewGrade) {
    if (!current || !revealed || busy || cardError || mutation.current || confirmingDelete) return;
    await mutate(async () => {
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
    });
  }
  async function undo() {
    if (!lastAction || mutation.current || saving || confirmingDelete) return;
    await mutate(async () => {
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
    });
  }
  function requestDelete() {
    if (!current || busy || cardError || mutation.current) return;
    setActionsOpen(false);
    setConfirmingDelete(true);
  }
  const noteSiblings = (card: Card | WorkspaceCard) =>
    card.source ? cards.filter((entry) => entry.source?.noteId === card.source!.noteId) : [card];
  async function deleteCurrent() {
    if (!current || busy || cardError || mutation.current) return;
    const ids = isWorkspaceCard(current)
      ? (loadedCard?.content?.sourceCardIds ?? [])
      : noteSiblings(current).map((card) => card.id);
    setConfirmingDelete(false);
    await mutate(async () => {
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
    });
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
  function discardEdit() {
    if (saving) return;
    setEditDraft(undefined);
    setFieldErrors({});
  }
  async function saveEdit() {
    if (!current || !editDraft || mutation.current) return;
    await mutate(async () => {
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
        const siblings = noteSiblings(current);
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
    });
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
  const imageTarget = useRef<DraftFieldName>("question");
  async function insertImage() {
    if (busy || mutation.current || preview) return;
    const root = preferences.root;
    if (!root || preferences.deck === "scratch") {
      setFieldErrors({ deckPath: "Choose a workspace deck before inserting an image." });
      return;
    }
    const target = preferences.cardType === "cloze" ? "content" : imageTarget.current;
    await mutate(async () => {
      const result = await insertClipboardImage(
        root,
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
    });
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
  function toggleActions() {
    if (confirmingDelete) return;
    setActionsOpen(!actionsOpen);
    setActionIndex(0);
  }
  function back() {
    if (editDraft) discardEdit();
    else if (preview) setPreview(undefined);
    else panel.hide();
  }
  function skipCard() {
    setProgress({ ...progress, queue: queue.slice(1) });
    setRevealed(false);
  }
  const reloadCard = () => setReload((value) => value + 1);
  const clearFieldError = (field: string) =>
    setFieldErrors((errors) => {
      if (!errors[field]) return errors;
      const next = { ...errors };
      delete next[field];
      return next;
    });
  const draftSetters = { question: setQuestion, answer: setAnswer, content: setCloze } as const;
  const editDraftField = (field: DraftFieldName, value: string) => {
    imageTarget.current = field;
    setFocus(field);
    draftSetters[field](value);
    setNotice(null);
    clearFieldError(field);
  };
  const editReviewField = (field: DraftFieldName, value: string) => {
    if (!editDraft) return;
    if (editDraft.cardType === "qa") {
      if (field === "question") setEditDraft({ ...editDraft, question: value });
      else if (field === "answer") setEditDraft({ ...editDraft, answer: value });
    } else if (field === "content") setEditDraft({ ...editDraft, content: value });
    clearFieldError(field);
  };
  const draftField = (name: DraftFieldName): DraftFieldState => ({
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
  const menu: MenuItem[] = [
    ...(editDraft
      ? [
          { label: "Save Changes", key: "⌘ ↵", run: () => void saveEdit() },
          { label: "Discard Changes", key: "Esc", run: discardEdit },
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
                  { label: "Retry Card", key: "⌘ R", run: reloadCard },
                  { label: "Skip Card", key: "", run: skipCard },
                ]
              : []),
          ]),
    { label: "Choose Workspace…", key: "", run: () => events.preferences() },
    { label: pinned ? "Stop Keeping on Top" : "Keep on Top", key: "⌘ ⇧ P", run: togglePin },
    ...(screen === "review" && !editDraft
      ? [{ label: "Restart Review", key: "", run: restart }]
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
        else back();
      } else if (cmd && event.key === "k") toggleActions();
      else if (cmd && event.key === "p" && event.modifiers?.shift) togglePin();
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
        else if (cardError) reloadCard();
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
  const grading = screen === "review" && !editDraft && revealed && current && !cardError;
  const reviewView: ReviewView = startError
    ? { kind: "startError", error: startError }
    : loadingCard
      ? { kind: "loadingCard" }
      : cardError
        ? { kind: "cardError", error: cardError, deckPath: currentDeckPath }
        : current
          ? {
              kind: "card",
              cardType: current.cardType === "cloze" ? "cloze" : "qa",
              prompt: current.question,
              reveal: current.answer,
              revealed,
              deckPath: currentDeckPath,
            }
          : busy
            ? { kind: "loading" }
            : progress.grades.length || lastAction
              ? { kind: "complete", grades: progress.grades }
              : { kind: "empty" };

  return (
    <Shell
      onBack={back}
      progress={
        screen === "review" && (current || lastAction)
          ? `${progress.grades.length} reviewed · ${queue.length} remaining${lastAction ? " · ⌘Z Undo" : ""}`
          : undefined
      }
      notice={notice}
      footer={{
        context: screen === "create" ? "Create Card" : current ? currentDeckName : "Review Cards",
        grading: grading
          ? {
              onAgain: () => grade("again"),
              onHard: () => grade("hard"),
              onEasy: () => grade("easy"),
            }
          : undefined,
        primary: {
          label: primaryLabel,
          keys: editDraft || screen === "create" ? "⌘ ↵" : revealed ? "Space / 3" : "Space",
          onClick: primary,
        },
        onActions: toggleActions,
      }}
      overlays={
        <>
          {confirmingDelete && current && (
            <DeleteDialog
              cardType={current.cardType === "cloze" ? "cloze" : "qa"}
              cardCount={loadedCard?.content?.sourceCardIds.length ?? noteSiblings(current).length}
              onCancel={() => setConfirmingDelete(false)}
              onConfirm={() => void deleteCurrent()}
            />
          )}
          {actionsOpen && (
            <ActionsMenu
              items={menu}
              activeIndex={actionIndex}
              onActivate={setActionIndex}
              onSelect={(item) => {
                item.run();
                setActionsOpen(false);
              }}
            />
          )}
        </>
      }
    >
      {editDraft ? (
        <EditScreen
          draft={editDraft}
          field={draftField}
          onChange={editReviewField}
          onDiscard={discardEdit}
        />
      ) : screen === "create" && preview ? (
        <PreviewScreen
          cards={preview}
          index={previewIndex}
          deckPath={preferences.deck === "scratch" ? undefined : preferences.deck}
          onEdit={openPreview}
          onIndexChange={setPreviewIndex}
        />
      ) : screen === "create" ? (
        <CreateScreen
          editorKey={editorKey}
          cardType={preferences.cardType}
          deck={{
            value: preferences.deck,
            open: openSelect === "deck",
            onOpenChange: (open) => setOpenSelect(open ? "deck" : null),
            options: [
              ...decks.map((deck) => ({ value: deck.absolutePath, label: deck.name })),
              { value: "scratch", label: "Overlay (scratch deck)" },
            ],
            onChange: (deck) => {
              if (!saving) {
                updatePreferences({ deck });
                setFieldErrors({});
              }
            },
            error: fieldErrors.deckPath,
          }}
          type={{
            open: openSelect === "type",
            onOpenChange: (open) => setOpenSelect(open ? "type" : null),
            onChange: (type) => {
              if (!saving) {
                updatePreferences({ cardType: type === "cloze" ? "cloze" : "qa" });
                setFieldErrors({});
              }
            },
          }}
          draft={{ question, answer, content: cloze }}
          initialFocus={imageTarget.current}
          field={draftField}
          onChange={editDraftField}
        />
      ) : (
        <ReviewScreen
          key={current?.id ?? "empty-review"}
          view={reviewView}
          issues={issues}
          onRestart={restart}
          onReloadCard={reloadCard}
          onSkipCard={skipCard}
          onOpenDeck={openDeck}
          onChooseWorkspace={() => events.preferences()}
        />
      )}
    </Shell>
  );
}
