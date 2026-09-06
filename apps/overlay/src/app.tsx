import { basename } from "node:path";
import { useEffect, useState, type ReactNode } from "react";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  createRenderer,
  createRoot,
  flushSync,
  startFrameLoop,
  type EventPayload,
} from "@gpuix/react";
import type { DeckEntry } from "@simbyotic/re/workspace";
import { loadCards, saveCards, type Card } from "./cards";
import { CardMarkdown } from "./card-markdown";
import { DeckCombobox } from "./deck-combobox";
import { toErrorMessage } from "./error-message";
import { takeLaunchRequest, type Screen } from "./launch";
import { onSettled } from "./on-settled";
import { panel } from "./panel";
import { loadPreferences, savePreferences, type Preferences } from "./preferences";
import { reviewKey, type ReviewGrade } from "./review-controls";
import { cardsPath } from "./storage";
import { colors, column, editorTheme, menuItem, menuSurface, menuTrigger, row } from "./theme";
import {
  listDecks,
  prepareScratch,
  createInDeck,
  loadReview,
  gradeInDeck,
  disposeWorkspace,
  type Draft,
  type WorkspaceCard,
} from "./workspace";

const initialPreferences = loadPreferences();
const initialScreen = takeLaunchRequest() ?? "create";

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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ ...row, gap: 20 }}>
      <text style={{ width: 70, textAlign: "right", color: colors.muted, fontSize: 12 }}>
        {label}
      </text>
      {children}
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
}: {
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
    <Field label={label}>
      <textarea
        readOnly={readOnly}
        testId={testId}
        autoFocus={autoFocus || undefined}
        value={value}
        onChange={(event) => onChange(event.value ?? "")}
        onFocus={onFocus}
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
          borderColor: focused ? "#ffffff55" : colors.line,
          padding: 12,
          fontSize: 14,
        }}
      />
    </Field>
  );
}

const renderer = createRenderer();
renderer.init({
  title: "re Pocket",
  width: 720,
  height: 465,
  minWidth: 300,
  minHeight: 232.5,
  titlebarTransparent: true,
  windowBackground: "blurred",
  show: false,
  focus: false,
});
const shortcutStatus = panel.initialize();
if (shortcutStatus === -1) throw new Error("Could not find the GPUIX window.");
if (shortcutStatus !== 0)
  console.warn(`Global shortcut unavailable (${shortcutStatus}); use Raycast or the menu bar.`);

let initialCards: Card[] = [];
let loadFailure: Notice | null = null;
try {
  initialCards = loadCards();
} catch (error) {
  loadFailure = failure(toErrorMessage(error));
}
// The entry point owns native events; React supplies the current screen's actions.
const events: {
  key: (event: EventPayload) => void;
  route: (screen: Screen) => void;
} = {
  key: () => {},
  route: () => {},
};

function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [decks, setDecks] = useState<readonly DeckEntry[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [cloze, setCloze] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [focus, setFocus] = useState("question");
  const [openSelect, setOpenSelect] = useState<"deck" | "type" | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewLoaded, setReviewLoaded] = useState(false);
  const [workspaceCards, setWorkspaceCards] = useState<WorkspaceCard[]>([]);
  const [cards, setCards] = useState(initialCards);
  const [queue, setQueue] = useState(initialCards.map((card) => card.id));
  const [revealed, setRevealed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(loadFailure);
  const [pinned, setPinned] = useState(true);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionIndex, setActionIndex] = useState(0);
  const loadingReview = screen === "review" && preferences.root !== null && !reviewLoaded;
  const busy = saving || loadingReview;
  const reviewCards: readonly (Card | WorkspaceCard)[] = preferences.root ? workspaceCards : cards;
  const current = reviewCards.find((card) => card.id === queue[0]);
  const currentDeckPath =
    current && "reference" in current ? current.reference.deckPath : undefined;
  const currentDeckName = currentDeckPath
    ? (decks.find((deck) => deck.absolutePath === currentDeckPath)?.name ??
      basename(currentDeckPath, ".md"))
    : "Pocket (scratch deck)";

  function updatePreferences(patch: Partial<Preferences>) {
    const next = { ...preferences, ...patch };
    try {
      savePreferences(next);
      setPreferences(next);
    } catch (error) {
      setNotice(failure(`Could not save preferences: ${toErrorMessage(error)}`));
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
    return onSettled(loadReview(root), (result) => {
      setReviewLoaded(true);
      if (!result.ok) {
        setNotice(failure(result.error));
        return;
      }
      setWorkspaceCards(result.value.cards);
      setQueue(result.value.cards.map((card) => card.id));
      setRevealed(false);
      if (result.value.skipped)
        setNotice(failure(`${result.value.skipped} unreadable decks or cards were skipped.`));
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
  async function create() {
    if (busy) return;
    const draft: Draft =
      preferences.cardType === "qa"
        ? { type: "qa", question, answer }
        : { type: "cloze", content: cloze };
    if (preferences.deck === "scratch") {
      const prepared = prepareScratch(draft);
      if (!prepared.ok) {
        setNotice(failure(prepared.error));
        return;
      }
      if (!commit([...cards, ...prepared.value])) return;
      if (!preferences.root) setQueue([...queue, ...prepared.value.map((card) => card.id)]);
    } else {
      if (!decks.some((deck) => deck.absolutePath === preferences.deck)) {
        setNotice(failure("Choose a deck from the current folder."));
        return;
      }
      setSaving(true);
      const result = await createInDeck(preferences.deck, draft);
      setSaving(false);
      if (!result.ok) {
        setNotice(failure(result.error));
        return;
      }
      setReviewLoaded(false);
    }
    setQuestion("");
    setAnswer("");
    setCloze("");
    setEditorKey(editorKey + 1);
    setFocus("question");
    setNotice(success("Card created"));
  }
  async function grade(lastGrade: ReviewGrade) {
    if (!current || !revealed || busy) return;
    if ("reference" in current) {
      setSaving(true);
      const result = await gradeInDeck(current, lastGrade);
      setSaving(false);
      if (!result.ok) {
        setNotice(failure(result.error));
        return;
      }
    } else if (
      !commit(cards.map((card) => (card.id === current.id ? { ...card, lastGrade } : card)))
    )
      return;
    setQueue(lastGrade === "again" ? [...queue.slice(1), current.id] : queue.slice(1));
    setRevealed(false);
    setNotice(null);
  }
  function primary() {
    if (busy) return;
    if (screen === "create") create();
    else if (!current) panel.hide();
    else if (revealed) grade("good");
    else setRevealed(true);
  }
  function togglePin() {
    panel.pin(!pinned);
    setPinned(!pinned);
    setActionsOpen(false);
  }
  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setNotice(null);
  };
  const draftField = (name: "question" | "answer" | "content") => ({
    focused: focus === name,
    readOnly: saving,
    onFocus: () => setFocus(name),
    onBlur: () => setFocus((current) => (current === name ? "" : current)),
  });
  const menu = [
    { label: pinned ? "Stop Keeping on Top" : "Keep on Top", key: "⌘ P", run: togglePin },
    ...(screen === "review"
      ? [
          {
            label: "Restart Review",
            key: "",
            run: () => {
              if (preferences.root) setReviewLoaded(false);
              else setQueue(cards.map((card) => card.id));
              setRevealed(false);
              setActionsOpen(false);
            },
          },
        ]
      : []),
    { label: "Close Window", key: "Esc", run: panel.hide },
    {
      label: "Quit",
      key: "⌘ Q",
      run: () => {
        void shutdown();
      },
    },
  ];
  useEffect(() => {
    events.route = (next) => {
      setScreen(next);
      setActionsOpen(false);
      setOpenSelect(null);
      setNotice(loadFailure);
    };
    events.key = (event) => {
      const cmd = event.modifiers?.cmd;
      if (openSelect) return;
      if (event.key === "escape") {
        if (actionsOpen) setActionsOpen(false);
        else panel.hide();
      } else if (cmd && event.key === "k") {
        setActionsOpen(!actionsOpen);
        setActionIndex(0);
      } else if (cmd && event.key === "p") togglePin();
      else if (actionsOpen) {
        if (event.key === "down") setActionIndex((actionIndex + 1) % menu.length);
        else if (event.key === "up") setActionIndex((actionIndex + menu.length - 1) % menu.length);
        else if (event.key === "enter") menu[actionIndex]?.run();
      } else if (
        screen === "create" &&
        event.key === "tab" &&
        !cmd &&
        !event.modifiers?.ctrl &&
        !event.modifiers?.alt
      ) {
        if (event.modifiers?.shift) renderer.focusPrevious();
        else renderer.focusNext();
      } else if (screen === "create" && cmd && event.key === "enter") primary();
      else if (screen === "review") {
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
        <div onClick={panel.hide} style={{ cursor: "pointer", padding: 5 }}>
          <text style={{ color: colors.muted, fontSize: 24 }}>‹</text>
        </div>
        {screen === "review" && current && (
          <text style={{ color: colors.muted, fontSize: 12 }}>{`${queue.length} remaining`}</text>
        )}
      </div>
      {screen === "create" ? (
        <div
          key={editorKey}
          style={{
            ...column,
            flexGrow: 1,
            paddingLeft: 70,
            paddingRight: 70,
            paddingTop: 9,
            gap: 17,
          }}
        >
          <Field label="Deck">
            <DeckCombobox
              value={preferences.deck}
              open={openSelect === "deck"}
              onOpenChange={(open) => setOpenSelect(open ? "deck" : null)}
              options={[
                ...decks.map((deck) => ({ value: deck.absolutePath, label: deck.name })),
                { value: "scratch", label: "Pocket (scratch deck)" },
              ]}
              onChange={(deck) => updatePreferences({ deck })}
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
              onChange={(type) =>
                updatePreferences({ cardType: type === "cloze" ? "cloze" : "qa" })
              }
            />
          </Field>
          <div style={{ height: 1, backgroundColor: colors.line }} />
          {preferences.cardType === "qa" ? (
            <>
              <DraftField
                label="Question"
                testId="question"
                autoFocus
                value={question}
                onChange={edit(setQuestion)}
                placeholder="What do you want to remember?"
                rows={2}
                {...draftField("question")}
              />
              <DraftField
                label="Answer"
                testId="answer"
                value={answer}
                onChange={edit(setAnswer)}
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
              onChange={edit(setCloze)}
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
              gap: 25,
            }}
          >
            {current ? (
              <>
                <CardMarkdown
                  testId="prompt"
                  source={current.question}
                  deckPath={currentDeckPath}
                />
                {revealed && (
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
                  {busy ? "Loading cards…" : reviewCards.length ? "All done" : "No cards due"}
                </text>
                <text style={{ color: colors.muted, fontSize: 13 }}>
                  {busy
                    ? ""
                    : reviewCards.length
                      ? "You’ve finished this review."
                      : "You’re caught up. Create cards from Raycast."}
                </text>
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
          {screen === "review" && revealed && current && (
            <>
              <Action label="Again" onClick={() => grade("again")} testId="again" />
              <Action label="Hard" onClick={() => grade("hard")} testId="hard" />
            </>
          )}
          <Action
            label={primaryLabel}
            keys={screen === "create" ? "⌘ ↵" : "Space"}
            primary
            onClick={primary}
            testId="primary"
          />
          {screen === "review" && revealed && current && (
            <Action label="Easy" onClick={() => grade("easy")} testId="easy" />
          )}
          <div style={{ width: 1, height: 16, backgroundColor: colors.line }} />
          <Action
            label="Actions"
            keys="⌘ K"
            onClick={() => {
              setActionsOpen(!actionsOpen);
              setActionIndex(0);
            }}
            testId="actions"
          />
        </div>
      </div>
      {actionsOpen && (
        <div
          style={{
            ...menuSurface,
            position: "absolute",
            bottom: 49,
            right: 12,
            width: 258,
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
              onClick={item.run}
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

const root = createRoot(renderer, { onKeyDown: (event) => flushSync(() => events.key(event)) });
flushSync(() => root.render(<App />));
const routeTimer = setInterval(() => {
  if (panel.takeRoute() === "quit") {
    void shutdown();
    return;
  }
  const screen = takeLaunchRequest();
  if (!screen) return;
  flushSync(() => events.route(screen));
  panel.show();
}, 40);
const loop = startFrameLoop(
  { requiresTick: () => true, tick: panel.pump },
  {
    frameMs: 16,
    onTerminated: () => {
      void shutdown();
    },
  },
);
process.on("exit", () => {
  clearInterval(routeTimer);
  loop.stop();
  panel.dispose();
});
let quitting = false;
async function shutdown() {
  if (quitting) return;
  quitting = true;
  await disposeWorkspace();
  process.exit(0);
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
console.log(`re Pocket ready. Scratch cards: ${cardsPath}`);
