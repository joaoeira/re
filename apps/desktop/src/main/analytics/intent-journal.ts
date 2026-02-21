import fs from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";

import type { CompensationIntent } from "./types";

interface IntentJournalFile {
  readonly version: 1;
  readonly intents: readonly CompensationIntent[];
}

export interface CompensationIntentJournal {
  readonly persistPendingIntent: (intent: CompensationIntent) => Effect.Effect<void, unknown>;
  readonly markCompleted: (intentId: string) => Effect.Effect<void, unknown>;
  readonly markConflict: (intentId: string, message: string) => Effect.Effect<void, unknown>;
  readonly markPendingFailure: (intentId: string, message: string) => Effect.Effect<void, unknown>;
  readonly loadPendingIntents: () => Effect.Effect<readonly CompensationIntent[], unknown>;
  readonly summarize: () => Effect.Effect<{ pending: number; conflict: number }, unknown>;
}

const DEFAULT_JOURNAL: IntentJournalFile = {
  version: 1,
  intents: [],
};

const normalizeIntent = (intent: CompensationIntent): CompensationIntent => ({
  ...intent,
  lastError: intent.lastError ?? null,
});

const compactPendingByReviewEntryId = (
  intents: readonly CompensationIntent[],
): readonly CompensationIntent[] => {
  const nonPending = intents.filter((intent) => intent.status !== "pending");
  const pendingByReviewEntryId = new Map<number, CompensationIntent>();

  for (const intent of intents) {
    if (intent.status !== "pending") {
      continue;
    }
    pendingByReviewEntryId.set(intent.reviewEntryId, intent);
  }

  return [...nonPending, ...pendingByReviewEntryId.values()];
};

const decodeJournal = (raw: string): IntentJournalFile => {
  const decoded = JSON.parse(raw) as { version?: unknown; intents?: unknown };

  if (decoded.version !== 1 || !Array.isArray(decoded.intents)) {
    throw new Error("Compensation intent journal has invalid structure.");
  }

  const intents: CompensationIntent[] = decoded.intents.map((intent, index) => {
    if (typeof intent !== "object" || intent === null) {
      throw new Error(`Compensation intent at index ${index} is invalid.`);
    }

    const typed = intent as CompensationIntent;
    if (
      typeof typed.intentId !== "string" ||
      typeof typed.reviewEntryId !== "number" ||
      !Number.isInteger(typed.reviewEntryId) ||
      typed.reviewEntryId < 1 ||
      typeof typed.deckPath !== "string" ||
      typeof typed.cardId !== "string" ||
      typeof typed.expectedCurrentCardFingerprint !== "string" ||
      typeof typed.previousCardFingerprint !== "string" ||
      typeof typed.createdAt !== "string" ||
      typeof typed.attemptCount !== "number" ||
      (typed.status !== "pending" && typed.status !== "completed" && typed.status !== "conflict")
    ) {
      throw new Error(`Compensation intent at index ${index} is malformed.`);
    }

    return normalizeIntent(typed);
  });

  return {
    version: 1,
    intents: compactPendingByReviewEntryId(intents),
  };
};

const encodeJournal = (journal: IntentJournalFile): string =>
  JSON.stringify(
    {
      version: 1,
      intents: journal.intents,
    } satisfies IntentJournalFile,
    null,
    2,
  );

const readJournalFile = (journalPath: string): Effect.Effect<IntentJournalFile, unknown> =>
  Effect.tryPromise(async () => {
    try {
      const raw = await fs.readFile(journalPath, "utf8");
      return decodeJournal(raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return DEFAULT_JOURNAL;
      }
      throw error;
    }
  });

const writeJournalFileAtomic = (
  journalPath: string,
  journal: IntentJournalFile,
): Effect.Effect<void, unknown> =>
  Effect.tryPromise(async () => {
    const directory = path.dirname(journalPath);
    const tempPath = `${journalPath}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    const payload = encodeJournal(journal);

    await fs.mkdir(directory, { recursive: true });

    const file = await fs.open(tempPath, "w");
    try {
      await file.writeFile(payload, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }

    await fs.rename(tempPath, journalPath);

    if (process.platform !== "win32") {
      const dirHandle = await fs.open(directory, "r");
      try {
        await dirHandle.sync();
      } finally {
        await dirHandle.close();
      }
    }
  });

const updateJournal = <A>(
  journalPath: string,
  transform: (journal: IntentJournalFile) => { readonly journal: IntentJournalFile; readonly out: A },
): Effect.Effect<A, unknown> =>
  Effect.gen(function* () {
    const current = yield* readJournalFile(journalPath);
    const result = transform(current);
    yield* writeJournalFileAtomic(journalPath, result.journal);
    return result.out;
  });

export const createCompensationIntentJournal = (journalPath: string): CompensationIntentJournal => {
  const semaphore = Effect.runSync(Effect.makeSemaphore(1));
  const withLock = semaphore.withPermits(1);

  return {
    persistPendingIntent: (intent) =>
      withLock(
        updateJournal(journalPath, (journal) => ({
          journal: {
            ...journal,
            intents: compactPendingByReviewEntryId([...journal.intents, normalizeIntent(intent)]),
          },
          out: undefined,
        })),
      ),
    markCompleted: (intentId) =>
      withLock(
        updateJournal(journalPath, (journal) => ({
          journal: {
            ...journal,
            intents: journal.intents.map((intent) =>
              intent.intentId === intentId
                ? { ...intent, status: "completed", lastError: null }
                : intent,
            ),
          },
          out: undefined,
        })),
      ),
    markConflict: (intentId, message) =>
      withLock(
        updateJournal(journalPath, (journal) => ({
          journal: {
            ...journal,
            intents: journal.intents.map((intent) =>
              intent.intentId === intentId
                ? {
                    ...intent,
                    status: "conflict",
                    lastError: message,
                    attemptCount: intent.attemptCount + 1,
                  }
                : intent,
            ),
          },
          out: undefined,
        })),
      ),
    markPendingFailure: (intentId, message) =>
      withLock(
        updateJournal(journalPath, (journal) => ({
          journal: {
            ...journal,
            intents: journal.intents.map((intent) =>
              intent.intentId === intentId
                ? {
                    ...intent,
                    status: "pending",
                    lastError: message,
                    attemptCount: intent.attemptCount + 1,
                  }
                : intent,
            ),
          },
          out: undefined,
        })),
      ),
    loadPendingIntents: () =>
      withLock(
        readJournalFile(journalPath).pipe(
          Effect.map((journal) => journal.intents.filter((intent) => intent.status === "pending")),
        ),
      ),
    summarize: () =>
      withLock(
        readJournalFile(journalPath).pipe(
          Effect.map((journal) => ({
            pending: journal.intents.filter((intent) => intent.status === "pending").length,
            conflict: journal.intents.filter((intent) => intent.status === "conflict").length,
          })),
        ),
      ),
  };
};
