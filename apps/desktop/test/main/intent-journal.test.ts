import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createCompensationIntentJournal } from "@main/analytics/intent-journal";
import type { CompensationIntent } from "@main/analytics/types";

const makeIntent = (
  overrides: Partial<CompensationIntent> = {},
): CompensationIntent => ({
  intentId: "intent-1",
  reviewEntryId: 1,
  deckPath: "/workspace/deck.md",
  cardId: "card-1",
  expectedCurrentCardFingerprint: "expected",
  previousCardFingerprint: "previous",
  createdAt: "2026-01-01T00:00:00.000Z",
  attemptCount: 0,
  status: "pending",
  lastError: null,
  ...overrides,
});

describe("compensation intent journal", () => {
  it("atomically persists intents and compacts duplicate pending reviewEntryId records", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-intent-journal-"));
    const journalPath = path.join(rootPath, "analytics-compensation-intents.json");
    const journal = createCompensationIntentJournal(journalPath);

    try {
      await Effect.runPromise(journal.persistPendingIntent(makeIntent()));
      await Effect.runPromise(
        journal.persistPendingIntent(
          makeIntent({
            intentId: "intent-2",
            reviewEntryId: 1,
            createdAt: "2026-01-01T00:00:10.000Z",
          }),
        ),
      );

      const pending = await Effect.runPromise(journal.loadPendingIntents());
      expect(pending).toHaveLength(1);
      expect(pending[0]!.intentId).toBe("intent-2");

      const raw = await fs.readFile(journalPath, "utf8");
      expect(raw).toContain("\"version\": 1");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("tracks pending and conflict counts while updating status", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-intent-journal-"));
    const journalPath = path.join(rootPath, "analytics-compensation-intents.json");
    const journal = createCompensationIntentJournal(journalPath);

    try {
      await Effect.runPromise(
        journal.persistPendingIntent(
          makeIntent({
            intentId: "intent-10",
            reviewEntryId: 10,
          }),
        ),
      );

      await Effect.runPromise(journal.markPendingFailure("intent-10", "sqlite unavailable"));
      const afterFailure = await Effect.runPromise(journal.loadPendingIntents());
      expect(afterFailure[0]!.attemptCount).toBe(1);
      expect(afterFailure[0]!.lastError).toContain("sqlite unavailable");

      await Effect.runPromise(journal.markConflict("intent-10", "fingerprint mismatch"));
      const summaryAfterConflict = await Effect.runPromise(journal.summarize());
      expect(summaryAfterConflict.pending).toBe(0);
      expect(summaryAfterConflict.conflict).toBe(1);

      await Effect.runPromise(
        journal.persistPendingIntent(
          makeIntent({
            intentId: "intent-11",
            reviewEntryId: 11,
          }),
        ),
      );
      await Effect.runPromise(journal.markCompleted("intent-11"));
      const summaryAfterCompletion = await Effect.runPromise(journal.summarize());
      expect(summaryAfterCompletion.pending).toBe(0);
      expect(summaryAfterCompletion.conflict).toBe(1);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
