import {
  Action,
  ActionPanel,
  Form,
  Icon,
  LocalStorage,
  Toast,
  getPreferenceValues,
  openExtensionPreferences,
  showHUD,
  showToast,
} from "@raycast/api";
import { useCallback, useEffect, useRef, useState } from "react";

import { createCardForUi, loadDecksForUi, type CardField, type CardType } from "./card-creation";
import { runRaycastEffect } from "./runtime";

type FormErrors = Partial<Record<CardField, string>>;

const LAST_DECK_KEY = "last-selected-deck";

const successMessage = (cardCount: number): string =>
  cardCount === 1 ? "Card created" : `${cardCount} cards created`;

export default function CreateCardCommand() {
  const preferences = getPreferenceValues<Preferences>();
  const [decks, setDecks] = useState<
    readonly {
      readonly absolutePath: string;
      readonly relativePath: string;
      readonly name: string;
    }[]
  >([]);
  const [selectedDeckPath, setSelectedDeckPath] = useState("");
  const [cardType, setCardType] = useState<CardType>("qa");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [content, setContent] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [deckLoadError, setDeckLoadError] = useState<string>();
  const [isLoadingDecks, setIsLoadingDecks] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitInFlight = useRef(false);

  const clearError = useCallback((field: CardField) => {
    setErrors((current) => {
      if (current[field] === undefined) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }, []);

  const reloadDecks = useCallback(async () => {
    setIsLoadingDecks(true);
    setDeckLoadError(undefined);

    const [result, lastDeckPath] = await Promise.all([
      runRaycastEffect(loadDecksForUi(preferences.workspacePath)),
      LocalStorage.getItem<string>(LAST_DECK_KEY),
    ]);

    if (result._tag === "DecksLoadError") {
      setDecks([]);
      setSelectedDeckPath("");
      setDeckLoadError(result.message);
      setIsLoadingDecks(false);
      return;
    }

    setDecks(result.decks);
    setSelectedDeckPath((current) => {
      if (result.decks.some((deck) => deck.absolutePath === current)) return current;
      if (
        lastDeckPath !== undefined &&
        result.decks.some((deck) => deck.absolutePath === lastDeckPath)
      ) {
        return lastDeckPath;
      }
      return result.decks[0]?.absolutePath ?? "";
    });
    setDeckLoadError(
      result.decks.length === 0
        ? "No Markdown decks were found in the configured folder."
        : undefined,
    );
    setIsLoadingDecks(false);
  }, [preferences.workspacePath]);

  useEffect(() => {
    void reloadDecks();
  }, [reloadDecks]);

  const selectDeck = useCallback(
    (deckPath: string) => {
      setSelectedDeckPath(deckPath);
      clearError("deckPath");
      void LocalStorage.setItem(LAST_DECK_KEY, deckPath);
    },
    [clearError],
  );

  const submit = useCallback(async () => {
    if (submitInFlight.current) return false;

    submitInFlight.current = true;
    setIsSubmitting(true);
    setErrors({});
    try {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: "Creating card…",
      });

      const result = await runRaycastEffect(
        createCardForUi({
          cardType,
          deckPath: selectedDeckPath,
          question,
          answer,
          content,
        }),
      );

      if (result._tag === "FieldError") {
        setErrors({ [result.field]: result.message });
        toast.style = Toast.Style.Failure;
        toast.title = "Check the card";
        toast.message = result.message;
        return false;
      }

      if (result._tag === "OperationError") {
        toast.style = Toast.Style.Failure;
        toast.title = "Could not create card";
        toast.message = result.message;
        return false;
      }

      const message = successMessage(result.cardCount);
      setQuestion("");
      setAnswer("");
      setContent("");

      if (preferences.closeAfterSubmit) {
        await toast.hide();
        await showHUD(message);
        return true;
      }

      toast.style = Toast.Style.Success;
      toast.title = message;
      toast.message = undefined;
      return true;
    } finally {
      submitInFlight.current = false;
      setIsSubmitting(false);
    }
  }, [answer, cardType, content, preferences.closeAfterSubmit, question, selectedDeckPath]);

  const deckError = errors.deckPath ?? deckLoadError;

  return (
    <Form
      isLoading={isLoadingDecks || isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Create Card"
            icon={Icon.Plus}
            shortcut={{ modifiers: ["cmd"], key: "enter" }}
            onSubmit={submit}
          />
          <Action
            title="Refresh Decks"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={reloadDecks}
          />
          <Action
            title="Open Extension Preferences"
            icon={Icon.Gear}
            onAction={openExtensionPreferences}
          />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="deckPath"
        title="Deck"
        placeholder="Choose a deck"
        value={selectedDeckPath}
        {...(deckError === undefined ? {} : { error: deckError })}
        onChange={selectDeck}
      >
        {decks.map((deck) => (
          <Form.Dropdown.Item
            key={deck.absolutePath}
            value={deck.absolutePath}
            title={deck.name}
            keywords={[deck.relativePath]}
          />
        ))}
      </Form.Dropdown>

      <Form.Dropdown
        id="cardType"
        title="Card Type"
        value={cardType}
        onChange={(value) => {
          setCardType(value as CardType);
          setErrors({});
        }}
      >
        <Form.Dropdown.Item value="qa" title="Question and Answer" />
        <Form.Dropdown.Item value="cloze" title="Cloze" />
      </Form.Dropdown>

      <Form.Separator />

      {cardType === "qa" ? (
        <>
          <Form.TextArea
            id="question"
            title="Question"
            placeholder="What do you want to remember?"
            enableMarkdown
            autoFocus
            value={question}
            {...(errors.question === undefined ? {} : { error: errors.question })}
            onChange={(value) => {
              setQuestion(value);
              clearError("question");
            }}
          />
          <Form.TextArea
            id="answer"
            title="Answer"
            placeholder="The answer"
            enableMarkdown
            value={answer}
            {...(errors.answer === undefined ? {} : { error: errors.answer })}
            onChange={(value) => {
              setAnswer(value);
              clearError("answer");
            }}
          />
        </>
      ) : (
        <Form.TextArea
          id="content"
          title="Content"
          placeholder="The {{c1::capital}} of Portugal is Lisbon."
          info="Use {{c1::answer}} or {{c1::answer::hint}}. Each unique index creates one card."
          enableMarkdown
          autoFocus
          value={content}
          {...(errors.content === undefined ? {} : { error: errors.content })}
          onChange={(value) => {
            setContent(value);
            clearError("content");
          }}
        />
      )}

      <Form.Description title="Create" text="Press ⌘ ↵ to write the card to the selected deck." />
    </Form>
  );
}
