import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";

import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import { parseFile } from "@re/core";

import {
  makeInMemoryForgeSessionRepository,
  ForgeSessionRepositoryError,
  type ForgeSessionRepository,
} from "@main/forge/services/forge-session-repository";
import type { ChunkService } from "@main/forge/services/chunk-service";
import {
  type PromptRunOptions,
  type PromptSpec,
  PromptInputValidationError,
  PromptModelInvocationError,
  PromptNormalizationError,
  PromptOutputParseError,
  PromptOutputValidationError,
} from "@main/forge/prompts";
import type { ForgePromptRuntime } from "@main/forge/services/prompt-runtime";
import {
  PdfFingerprintResolveError,
  PdfTextExtractError,
  type PdfExtractor,
} from "@main/forge/services/pdf-extractor";
import type {
  ForgeChunkPageBoundary,
  ForgeGenerateDerivedCardsResult,
  ForgeGetDerivedCardsResult,
} from "@shared/rpc/schemas/forge";
import { createHandlersWithOverrides } from "./helpers";

const createPdfExtractor = (options?: {
  readonly fingerprintByPath?: Record<string, string>;
  readonly textByPath?: Record<string, string>;
  readonly pageBreaksByPath?: Record<string, ReadonlyArray<ForgeChunkPageBoundary>>;
  readonly totalPagesByPath?: Record<string, number>;
  readonly failingPaths?: ReadonlySet<string>;
}): PdfExtractor => {
  const fingerprintByPath = options?.fingerprintByPath ?? {};
  const textByPath = options?.textByPath ?? {};
  const pageBreaksByPath = options?.pageBreaksByPath ?? {};
  const totalPagesByPath = options?.totalPagesByPath ?? {};
  const failingPaths = options?.failingPaths ?? new Set<string>();

  return {
    resolveFingerprint: (sourceFilePath) =>
      Effect.succeed(fingerprintByPath[sourceFilePath] ?? `fp:${sourceFilePath}`),
    extractText: (sourceFilePath) => {
      if (failingPaths.has(sourceFilePath)) {
        return Effect.fail(
          new PdfTextExtractError({
            sourceFilePath,
            message: `Failed to parse ${sourceFilePath}`,
          }),
        );
      }

      const text = textByPath[sourceFilePath] ?? "default extracted text";
      const pageBreaks = pageBreaksByPath[sourceFilePath] ?? [{ offset: 0, page: 1 }];
      const totalPages = totalPagesByPath[sourceFilePath] ?? Math.max(1, pageBreaks.length);

      return Effect.succeed({
        text,
        pageBreaks,
        totalPages,
        sourceFingerprint: fingerprintByPath[sourceFilePath] ?? `fp:${sourceFilePath}`,
      });
    },
  };
};

const createPromptRuntime = (
  run: (input: {
    readonly chunkText?: string;
    readonly sourceText?: string;
    readonly maxTopics?: number;
  }) => Effect.Effect<
    ReadonlyArray<string>,
    | PromptInputValidationError
    | PromptOutputParseError
    | PromptOutputValidationError
    | PromptNormalizationError
    | PromptModelInvocationError
  >,
): ForgePromptRuntime => ({
  run: <Input, Output>(
    _spec: PromptSpec<Input, Output>,
    input: Input,
    options?: PromptRunOptions,
  ) =>
    run(
      input as {
        readonly chunkText?: string;
        readonly sourceText?: string;
        readonly maxTopics?: number;
      },
    ).pipe(
      Effect.map((topics) => ({
        output: { topics } as unknown as Output,
        rawText: JSON.stringify({ topics }),
        metadata: {
          promptId: "forge/get-topics",
          promptVersion: "1",
          model: options?.model ?? "mock:model",
          attemptCount: 1,
          promptHash: "x".repeat(64),
          outputChars: topics.join(",").length,
        },
      })),
    ),
});

const createCardsDomainPromptRuntime = (options?: {
  readonly holdCreateCards?: Promise<void>;
  readonly failCreateCards?: boolean;
  readonly failReformulateCard?: boolean;
  readonly onGenerateExpansionsInput?: (input: {
    readonly topic: string;
    readonly ancestryChain: ReadonlyArray<{
      readonly selectedCard: { readonly question: string; readonly answer: string };
      readonly siblingCards: ReadonlyArray<{
        readonly question: string;
        readonly answer: string;
      }>;
      readonly instruction?: string;
    }>;
    readonly instruction?: string;
  }) => void;
  readonly onReformulateCardInput?: (input: {
    readonly contextText: string;
    readonly source: { readonly question: string; readonly answer: string };
  }) => void;
}): ForgePromptRuntime => ({
  run: <Input, Output>(
    spec: PromptSpec<Input, Output>,
    input: Input,
    runOptions?: PromptRunOptions,
  ) =>
    Effect.gen(function* () {
      if (
        spec.promptId === "forge/create-cards" ||
        spec.promptId === "forge/create-synthesis-cards"
      ) {
        if (options?.holdCreateCards) {
          yield* Effect.promise(() => options.holdCreateCards!);
        }

        if (options?.failCreateCards) {
          return yield* Effect.fail(
            new PromptOutputParseError({
              promptId: spec.promptId,
              message: "create-cards parse failure",
              rawExcerpt: "invalid",
            }),
          );
        }

        return {
          output: {
            cards: [
              { question: "What is ATP?", answer: "ATP is the cellular energy currency." },
              { question: "Where is ATP produced?", answer: "ATP is produced in mitochondria." },
            ],
          } as unknown as Output,
          rawText: '{"cards":[]}',
          metadata: {
            promptId: spec.promptId,
            promptVersion: "1",
            model: runOptions?.model ?? "mock:model",
            attemptCount: 1,
            promptHash: "x".repeat(64),
            outputChars: 10,
          },
        };
      }

      if (spec.promptId === "forge/generate-permutations") {
        const permutationsInput = input as {
          readonly source: { readonly question: string; readonly answer: string };
        };
        return {
          output: {
            permutations: [
              {
                question: `Permutation of: ${permutationsInput.source.question}`,
                answer: permutationsInput.source.answer,
              },
            ],
          } as unknown as Output,
          rawText: '{"permutations":[]}',
          metadata: {
            promptId: spec.promptId,
            promptVersion: "1",
            model: runOptions?.model ?? "mock:model",
            attemptCount: 1,
            promptHash: "x".repeat(64),
            outputChars: 10,
          },
        };
      }

      if (spec.promptId === "forge/generate-cloze") {
        const clozeInput = input as {
          readonly source: { readonly question: string; readonly answer: string };
        };
        const answerToken = clozeInput.source.answer.trim().split(/\s+/)[0];
        return {
          output: {
            cloze: `The energy currency of the cell is {{c1::${answerToken}}}.`,
          } as unknown as Output,
          rawText: '{"cloze":"x"}',
          metadata: {
            promptId: spec.promptId,
            promptVersion: "1",
            model: runOptions?.model ?? "mock:model",
            attemptCount: 1,
            promptHash: "x".repeat(64),
            outputChars: 10,
          },
        };
      }

      if (spec.promptId === "forge/reformulate-card") {
        const reformulateInput = input as {
          readonly contextText: string;
          readonly source: { readonly question: string; readonly answer: string };
        };
        options?.onReformulateCardInput?.(reformulateInput);

        if (options?.failReformulateCard) {
          return yield* Effect.fail(
            new PromptOutputParseError({
              promptId: spec.promptId,
              message: "reformulate-card parse failure",
              rawExcerpt: "invalid",
            }),
          );
        }

        return {
          output: {
            question: `Rewritten: ${reformulateInput.source.question}`,
            answer: `Rewritten: ${reformulateInput.source.answer}`,
          } as unknown as Output,
          rawText: '{"question":"x","answer":"y"}',
          metadata: {
            promptId: spec.promptId,
            promptVersion: "1",
            model: runOptions?.model ?? "mock:model",
            attemptCount: 1,
            promptHash: "x".repeat(64),
            outputChars: 10,
          },
        };
      }

      if (spec.promptId === "forge/generate-expansions") {
        const expansionInput = input as {
          readonly topic: string;
          readonly ancestryChain: ReadonlyArray<{
            readonly selectedCard: { readonly question: string; readonly answer: string };
            readonly siblingCards: ReadonlyArray<{
              readonly question: string;
              readonly answer: string;
            }>;
            readonly instruction?: string;
          }>;
          readonly instruction?: string;
        };
        options?.onGenerateExpansionsInput?.(expansionInput);
        const currentSelection = expansionInput.ancestryChain.at(-1)?.selectedCard;
        return {
          output: {
            cards: [
              {
                question: `Expansion of: ${currentSelection?.question ?? expansionInput.topic}`,
                answer: currentSelection?.answer ?? expansionInput.topic,
              },
            ],
          } as unknown as Output,
          rawText: '{"cards":[]}',
          metadata: {
            promptId: spec.promptId,
            promptVersion: "1",
            model: runOptions?.model ?? "mock:model",
            attemptCount: 1,
            promptHash: "x".repeat(64),
            outputChars: 10,
          },
        };
      }

      return yield* Effect.fail(
        new PromptInputValidationError({
          promptId: spec.promptId,
          message: "Unsupported prompt in test runtime.",
        }),
      );
    }),
});

const unwrapDerivedCardsResult = (
  result: ForgeGenerateDerivedCardsResult,
): ForgeGetDerivedCardsResult => {
  if ("confirmRequired" in result) {
    throw new Error("Expected derived cards result without confirmation.");
  }

  return result;
};

describe("forge handlers", () => {
  const setupHandlers = async (
    overrides: {
      readonly repository?: ForgeSessionRepository;
      readonly extractor?: PdfExtractor;
      readonly chunkService?: ChunkService;
      readonly promptRuntime?: ForgePromptRuntime;
      readonly publish?: NonNullable<Parameters<typeof createHandlersWithOverrides>[1]>["publish"];
    } = {},
  ) => {
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-forge-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const repository = overrides.repository ?? makeInMemoryForgeSessionRepository();
    const extractor = overrides.extractor ?? createPdfExtractor();
    const handlers = await createHandlersWithOverrides(settingsFilePath, {
      forgeSessionRepository: repository,
      pdfExtractor: extractor,
      ...(overrides.publish ? { publish: overrides.publish } : {}),
      ...(overrides.chunkService ? { chunkService: overrides.chunkService } : {}),
      ...(overrides.promptRuntime ? { forgePromptRuntime: overrides.promptRuntime } : {}),
    });

    return {
      handlers,
      repository,
      dispose: async () => {
        await fs.rm(settingsRoot, { recursive: true, force: true });
      },
    };
  };

  type ForgeHandlers = Awaited<ReturnType<typeof setupHandlers>>["handlers"];

  const pdfSource = (sourceFilePath: string) => ({
    kind: "pdf" as const,
    sourceFilePath,
  });

  const textSource = (input: { readonly text: string; readonly sourceLabel?: string }) => ({
    kind: "text" as const,
    text: input.text,
    ...(input.sourceLabel ? { sourceLabel: input.sourceLabel } : {}),
  });

  const createPdfSession = (handlers: ForgeHandlers, sourceFilePath: string) =>
    handlers.ForgeCreateSession({ source: pdfSource(sourceFilePath) });

  const createTextSession = (
    handlers: ForgeHandlers,
    input: {
      readonly text: string;
      readonly sourceLabel?: string;
    },
  ) => handlers.ForgeCreateSession({ source: textSource(input) });

  const previewPdfChunks = (handlers: ForgeHandlers, sourceFilePath: string) =>
    handlers.ForgePreviewChunks({ source: pdfSource(sourceFilePath) });

  const previewTextChunks = (
    handlers: ForgeHandlers,
    input: {
      readonly text: string;
      readonly sourceLabel?: string;
    },
  ) => handlers.ForgePreviewChunks({ source: textSource(input) });

  const extractPdfText = (
    handlers: ForgeHandlers,
    input: {
      readonly sessionId: number;
      readonly sourceFilePath?: string;
    },
  ) =>
    handlers.ForgeExtractText({
      sessionId: input.sessionId,
      source: pdfSource(input.sourceFilePath ?? "/tmp/forge-test-source.pdf"),
    });

  const extractTextSource = (
    handlers: ForgeHandlers,
    input: {
      readonly sessionId: number;
      readonly text: string;
      readonly sourceLabel?: string;
    },
  ) =>
    handlers.ForgeExtractText({
      sessionId: input.sessionId,
      source: textSource(input),
    });

  const startPdfTopicExtraction = (
    handlers: ForgeHandlers,
    input: {
      readonly sourceFilePath: string;
      readonly model?: string;
      readonly maxTopicsPerChunk?: number;
    },
  ) =>
    handlers.ForgeStartTopicExtraction({
      source: pdfSource(input.sourceFilePath),
      ...(input.model ? { model: input.model } : {}),
      ...(typeof input.maxTopicsPerChunk === "number"
        ? { maxTopicsPerChunk: input.maxTopicsPerChunk }
        : {}),
    });

  const getOnlyTopicId = async (
    repository: ForgeSessionRepository,
    sessionId: number,
  ): Promise<number> => {
    const snapshot = await Effect.runPromise(repository.getCardsSnapshotBySession(sessionId));
    const topicId = snapshot[0]?.topicId;
    if (!topicId) {
      throw new Error("Expected topic id.");
    }
    return topicId;
  };

  const seedDetailTopics = async (
    repository: ForgeSessionRepository,
    sessionId: number,
    writes: ReadonlyArray<{
      readonly sequenceOrder: number;
      readonly topics: ReadonlyArray<string>;
    }>,
  ): Promise<void> => {
    await Effect.runPromise(
      repository.replaceTopicsForSessionAndSetExtractionOutcome({
        sessionId,
        writes,
        status: "extracted",
        errorMessage: null,
      }),
    );
  };

  const getTopicIdBySequenceOrderAndIndex = async (
    repository: ForgeSessionRepository,
    sessionId: number,
    sequenceOrder: number,
    topicIndex: number,
  ): Promise<number> => {
    const snapshot = await Effect.runPromise(repository.getCardsSnapshotBySession(sessionId));
    const topicId = snapshot.find(
      (topic) => topic.sequenceOrder === sequenceOrder && topic.topicIndex === topicIndex,
    )?.topicId;
    if (!topicId) {
      throw new Error("Expected topic id.");
    }
    return topicId;
  };

  const getTopicBySequenceOrderAndIndex = async (
    repository: ForgeSessionRepository,
    sessionId: number,
    sequenceOrder: number,
    topicIndex: number,
  ) => {
    const topicId = await getTopicIdBySequenceOrderAndIndex(
      repository,
      sessionId,
      sequenceOrder,
      topicIndex,
    );
    return Effect.runPromise(repository.getTopicById(topicId));
  };

  const getCardsForTopicBySequenceOrderAndIndex = async (
    repository: ForgeSessionRepository,
    sessionId: number,
    sequenceOrder: number,
    topicIndex: number,
  ) => {
    const topicId = await getTopicIdBySequenceOrderAndIndex(
      repository,
      sessionId,
      sequenceOrder,
      topicIndex,
    );
    return Effect.runPromise(repository.getCardsForTopicId(topicId));
  };

  it("creates a session with source_kind=pdf and stores the computed fingerprint", async () => {
    const sourceFilePath = "/tmp/forge-a.pdf";
    const sourceFingerprint = "fingerprint:forge-a";
    const extractor = createPdfExtractor({
      fingerprintByPath: {
        [sourceFilePath]: sourceFingerprint,
      },
    });
    const { handlers, repository, dispose } = await setupHandlers({ extractor });

    try {
      const result = await Effect.runPromise(createPdfSession(handlers, sourceFilePath));

      expect(result.duplicateOfSessionId).toBeNull();
      expect(result.session.sourceKind).toBe("pdf");
      expect(result.session.sourceFilePath).toBe(sourceFilePath);
      expect(result.session.sourceFingerprint).toBe(sourceFingerprint);
      expect(result.session.status).toBe("created");

      const stored = await Effect.runPromise(repository.getSession(result.session.id));
      expect(stored).not.toBeNull();
      expect(stored?.sourceFingerprint).toBe(sourceFingerprint);
    } finally {
      await dispose();
    }
  });

  it("returns duplicateOfSessionId while still creating a new session", async () => {
    const sourceFilePath = "/tmp/forge-dup.pdf";
    const sourceFingerprint = "same-fingerprint";
    const extractor = createPdfExtractor({
      fingerprintByPath: {
        [sourceFilePath]: sourceFingerprint,
      },
    });
    const { handlers, dispose } = await setupHandlers({ extractor });

    try {
      const first = await Effect.runPromise(createPdfSession(handlers, sourceFilePath));
      const second = await Effect.runPromise(createPdfSession(handlers, sourceFilePath));

      expect(second.duplicateOfSessionId).toBe(first.session.id);
      expect(second.session.id).not.toBe(first.session.id);
      expect(second.session.sourceFingerprint).toBe(sourceFingerprint);
    } finally {
      await dispose();
    }
  });

  it("returns source_resolve_error when fingerprint resolution fails", async () => {
    const sourceFilePath = "/tmp/forge-fingerprint-failure.pdf";
    const extractor: PdfExtractor = {
      resolveFingerprint: () =>
        Effect.fail(
          new PdfFingerprintResolveError({
            sourceFilePath,
            message: "Failed to resolve fingerprint",
          }),
        ),
      extractText: () =>
        Effect.succeed({
          text: "",
          pageBreaks: [],
          totalPages: 1,
          sourceFingerprint: "",
        }),
    };
    const { handlers, dispose } = await setupHandlers({ extractor });

    try {
      const exit = await Effect.runPromiseExit(createPdfSession(handlers, sourceFilePath));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgeCreateSession to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("source_resolve_error");
      }
    } finally {
      await dispose();
    }
  });

  it("rejects relative source paths with source_resolve_error", async () => {
    const { handlers, dispose } = await setupHandlers();

    try {
      const exit = await Effect.runPromiseExit(createPdfSession(handlers, "./relative.pdf"));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgeCreateSession to fail for relative paths.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("source_resolve_error");
      }
    } finally {
      await dispose();
    }
  });

  it("creates a session with source_kind=text and stores a normalized fingerprint", async () => {
    const text = "  Alpha\r\nBeta  ";
    const expectedFingerprint = createHash("sha256").update("Alpha\nBeta", "utf8").digest("hex");
    const { handlers, dispose } = await setupHandlers();

    try {
      const result = await Effect.runPromise(
        createTextSession(handlers, {
          text,
          sourceLabel: "Pasted notes",
        }),
      );

      expect(result.duplicateOfSessionId).toBeNull();
      expect(result.session.sourceKind).toBe("text");
      expect(result.session.sourceLabel).toBe("Pasted notes");
      expect(result.session.sourceFilePath).toBeNull();
      expect(result.session.sourceFingerprint).toBe(expectedFingerprint);
      expect(result.session.status).toBe("created");
    } finally {
      await dispose();
    }
  });

  it("lists recent sessions with topic and card counts", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const { handlers, dispose } = await setupHandlers({ repository });

    try {
      const sessionA = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "Test PDF",
          sourceFilePath: "/tmp/list-a.pdf",
          deckPath: null,
          sourceFingerprint: "fp:list-a",
        }),
      );

      await Effect.runPromise(
        repository.saveChunks(sessionA.id, [
          { text: "chunk-0", sequenceOrder: 0, pageBoundaries: [{ offset: 0, page: 1 }] },
        ]),
      );
      await seedDetailTopics(repository, sessionA.id, [
        { sequenceOrder: 0, topics: ["alpha", "beta"] },
      ]);
      const alphaTopicId = await getTopicIdBySequenceOrderAndIndex(repository, sessionA.id, 0, 0);
      const betaTopicId = await getTopicIdBySequenceOrderAndIndex(repository, sessionA.id, 0, 1);
      await Effect.runPromise(
        repository.saveTopicSelectionsByTopicIds({
          sessionId: sessionA.id,
          topicIds: [alphaTopicId, betaTopicId],
        }),
      );

      const topic = await getTopicBySequenceOrderAndIndex(repository, sessionA.id, 0, 0);
      if (!topic) throw new Error("Expected persisted topic.");
      await Effect.runPromise(repository.tryStartTopicGeneration(topic.topicId));
      await Effect.runPromise(
        repository.replaceCardsForTopicAndFinishGenerationSuccess({
          topicId: topic.topicId,
          cards: [{ question: "Q1", answer: "A1" }],
        }),
      );

      await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "Test PDF",
          sourceFilePath: "/tmp/list-b.pdf",
          deckPath: null,
          sourceFingerprint: "fp:list-b",
        }),
      );

      const result = await Effect.runPromise(handlers.ForgeListSessions({}));
      expect(result.sessions).toHaveLength(2);

      const a = result.sessions.find((s) => s.sourceFilePath === "/tmp/list-a.pdf");
      const b = result.sessions.find((s) => s.sourceFilePath === "/tmp/list-b.pdf");
      expect(a?.topicCount).toBe(2);
      expect(a?.cardCount).toBe(1);
      expect(b?.topicCount).toBe(0);
      expect(b?.cardCount).toBe(0);
    } finally {
      await dispose();
    }
  });

  it("returns empty sessions array when no sessions exist", async () => {
    const { handlers, dispose } = await setupHandlers();

    try {
      const result = await Effect.runPromise(handlers.ForgeListSessions({}));
      expect(result.sessions).toEqual([]);
    } finally {
      await dispose();
    }
  });

  it("persists session deck path updates", async () => {
    const sourceFilePath = "/tmp/forge-deck-target.pdf";
    const { handlers, repository, dispose } = await setupHandlers();

    try {
      const created = await Effect.runPromise(createPdfSession(handlers, sourceFilePath));
      const deckPath = "/workspace/decks/biology.md";

      const result = await Effect.runPromise(
        handlers.ForgeSetSessionDeckPath({
          sessionId: created.session.id,
          deckPath,
        }),
      );

      expect(result).toEqual({});

      const stored = await Effect.runPromise(repository.getSession(created.session.id));
      expect(stored?.deckPath).toBe(deckPath);
    } finally {
      await dispose();
    }
  });

  it("persists chunks, updates status, and returns extraction summary", async () => {
    const sourceFilePath = "/tmp/forge-extract.pdf";
    const extractedText = "a".repeat(20_500);
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: extractedText,
      },
      pageBreaksByPath: {
        [sourceFilePath]: [
          { offset: 0, page: 1 },
          { offset: 12_000, page: 2 },
          { offset: 18_000, page: 3 },
        ],
      },
      totalPagesByPath: {
        [sourceFilePath]: 3,
      },
    });
    const { handlers, repository, dispose } = await setupHandlers({ extractor });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const created = await Effect.runPromise(createPdfSession(handlers, sourceFilePath));
      const extracted = await Effect.runPromise(
        extractPdfText(handlers, { sessionId: created.session.id, sourceFilePath }),
      );

      expect(extracted.sessionId).toBe(created.session.id);
      expect(extracted.textLength).toBe(extractedText.length);
      expect(extracted.preview.length).toBe(500);
      expect(extracted.preview).toBe(extractedText.slice(0, 500));
      expect(extracted.totalPages).toBe(3);
      expect(extracted.chunkCount).toBe(2);
      expect(consoleSpy).toHaveBeenCalledWith("[forge/extract]", {
        sessionId: created.session.id,
        textLength: extractedText.length,
        chunkCount: 2,
        totalPages: 3,
      });

      const stored = await Effect.runPromise(repository.getSession(created.session.id));
      expect(stored?.status).toBe("extracted");
      expect(stored?.errorMessage).toBeNull();

      const chunkCount = await Effect.runPromise(repository.getChunkCount(created.session.id));
      expect(chunkCount).toBe(2);
    } finally {
      consoleSpy.mockRestore();
      await dispose();
    }
  });

  it("persists chunks for text sources and returns a synthetic single-page extraction summary", async () => {
    const text = "A".repeat(20_500);
    const { handlers, repository, dispose } = await setupHandlers();

    try {
      const created = await Effect.runPromise(
        createTextSession(handlers, {
          text,
          sourceLabel: "Pasted text",
        }),
      );
      const extracted = await Effect.runPromise(
        extractTextSource(handlers, {
          sessionId: created.session.id,
          text,
          sourceLabel: "Pasted text",
        }),
      );

      expect(extracted.sessionId).toBe(created.session.id);
      expect(extracted.textLength).toBe(text.length);
      expect(extracted.totalPages).toBe(1);
      expect(extracted.chunkCount).toBe(2);

      const stored = await Effect.runPromise(repository.getSession(created.session.id));
      expect(stored?.status).toBe("extracted");
      expect(stored?.sourceKind).toBe("text");
      expect(stored?.sourceFilePath).toBeNull();

      const chunks = await Effect.runPromise(repository.getChunks(created.session.id));
      expect(chunks).toHaveLength(2);
      expect(chunks[0]?.pageBoundaries).toEqual([{ offset: 0, page: 1 }]);
      expect(chunks[1]?.pageBoundaries).toEqual([{ offset: 0, page: 1 }]);
    } finally {
      await dispose();
    }
  });

  it("returns source_mismatch when the provided text does not match the created session", async () => {
    const { handlers, repository, dispose } = await setupHandlers();

    try {
      const created = await Effect.runPromise(
        createTextSession(handlers, {
          text: "alpha beta gamma",
          sourceLabel: "Session text",
        }),
      );
      const exit = await Effect.runPromiseExit(
        extractTextSource(handlers, {
          sessionId: created.session.id,
          text: "different text",
          sourceLabel: "Session text",
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgeExtractText to fail for mismatched text.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("source_mismatch");
      }

      const stored = await Effect.runPromise(repository.getSession(created.session.id));
      expect(stored?.status).toBe("created");
      expect(stored?.errorMessage).toBeNull();
    } finally {
      await dispose();
    }
  });

  it("marks session as error when extraction succeeds but extracted-status update fails", async () => {
    const sourceFilePath = "/tmp/forge-post-update-failure.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: "text from pdf",
      },
    });
    const baseRepository = makeInMemoryForgeSessionRepository();
    const failingRepository: ForgeSessionRepository = {
      ...baseRepository,
      setSessionStatus: ({ sessionId, status, errorMessage }) => {
        if (status === "extracted") {
          return Effect.fail(
            new ForgeSessionRepositoryError({
              operation: "setSessionStatus",
              message: "Simulated extracted-status write failure",
            }),
          );
        }

        return baseRepository.setSessionStatus({ sessionId, status, errorMessage });
      },
    };
    const { handlers, repository, dispose } = await setupHandlers({
      extractor,
      repository: failingRepository,
    });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const created = await Effect.runPromise(createPdfSession(handlers, sourceFilePath));
      const exit = await Effect.runPromiseExit(
        extractPdfText(handlers, { sessionId: created.session.id, sourceFilePath }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgeExtractText to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("forge_operation_error");
      }

      const stored = await Effect.runPromise(repository.getSession(created.session.id));
      expect(stored?.status).toBe("error");
      expect(stored?.errorMessage).toContain("Simulated extracted-status write failure");
    } finally {
      consoleSpy.mockRestore();
      await dispose();
    }
  });

  it("marks the session as error when extraction fails", async () => {
    const sourceFilePath = "/tmp/forge-failure.pdf";
    const extractor = createPdfExtractor({
      failingPaths: new Set([sourceFilePath]),
    });
    const { handlers, repository, dispose } = await setupHandlers({ extractor });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const created = await Effect.runPromise(createPdfSession(handlers, sourceFilePath));
      const exit = await Effect.runPromiseExit(
        extractPdfText(handlers, { sessionId: created.session.id, sourceFilePath }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgeExtractText to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("source_resolve_error");
      }

      const stored = await Effect.runPromise(repository.getSession(created.session.id));
      expect(stored?.status).toBe("error");
      expect(stored?.errorMessage).toContain(sourceFilePath);
    } finally {
      consoleSpy.mockRestore();
      await dispose();
    }
  });

  it("returns empty_text and marks status error when extracted text is blank", async () => {
    const sourceFilePath = "/tmp/forge-empty-text.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: "\n  \t",
      },
      pageBreaksByPath: {
        [sourceFilePath]: [{ offset: 0, page: 1 }],
      },
      totalPagesByPath: {
        [sourceFilePath]: 1,
      },
    });
    const { handlers, repository, dispose } = await setupHandlers({ extractor });

    try {
      const created = await Effect.runPromise(createPdfSession(handlers, sourceFilePath));
      const exit = await Effect.runPromiseExit(
        extractPdfText(handlers, { sessionId: created.session.id, sourceFilePath }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgeExtractText to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("empty_text");
      }

      const stored = await Effect.runPromise(repository.getSession(created.session.id));
      expect(stored?.status).toBe("error");
      expect(stored?.errorMessage).toContain("No extractable text found");
    } finally {
      await dispose();
    }
  });

  it("returns already_chunked on extraction retry after a successful run", async () => {
    const sourceFilePath = "/tmp/forge-retry-already-chunked.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: "retry test text",
      },
      pageBreaksByPath: {
        [sourceFilePath]: [{ offset: 0, page: 1 }],
      },
      totalPagesByPath: {
        [sourceFilePath]: 1,
      },
    });
    const { handlers, repository, dispose } = await setupHandlers({ extractor });

    try {
      const created = await Effect.runPromise(createPdfSession(handlers, sourceFilePath));
      await Effect.runPromise(
        extractPdfText(handlers, { sessionId: created.session.id, sourceFilePath }),
      );

      const retryExit = await Effect.runPromiseExit(
        extractPdfText(handlers, { sessionId: created.session.id, sourceFilePath }),
      );

      expect(Exit.isFailure(retryExit)).toBe(true);
      if (Exit.isSuccess(retryExit)) {
        throw new Error("Expected extraction retry to fail.");
      }

      const failure = Cause.failureOption(retryExit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("already_chunked");
      }

      const stored = await Effect.runPromise(repository.getSession(created.session.id));
      expect(stored?.status).toBe("extracted");
      expect(stored?.errorMessage).toBeNull();
    } finally {
      await dispose();
    }
  });

  it("returns session_busy when extraction is already in progress", async () => {
    const sourceFilePath = "/tmp/forge-session-busy.pdf";
    const { handlers, repository, dispose } = await setupHandlers();

    try {
      const created = await Effect.runPromise(createPdfSession(handlers, sourceFilePath));
      await Effect.runPromise(
        repository.setSessionStatus({
          sessionId: created.session.id,
          status: "extracting",
          errorMessage: null,
        }),
      );

      const exit = await Effect.runPromiseExit(
        extractPdfText(handlers, { sessionId: created.session.id, sourceFilePath }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgeExtractText to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("session_busy");
      }
    } finally {
      await dispose();
    }
  });

  it("previews chunk estimates without creating a session", async () => {
    const sourceFilePath = "/tmp/forge-preview-success.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: "x".repeat(20_500),
      },
      pageBreaksByPath: {
        [sourceFilePath]: [
          { offset: 0, page: 1 },
          { offset: 12_000, page: 2 },
          { offset: 18_000, page: 3 },
        ],
      },
      totalPagesByPath: {
        [sourceFilePath]: 3,
      },
    });
    const { handlers, repository, dispose } = await setupHandlers({ extractor });

    try {
      const preview = await Effect.runPromise(previewPdfChunks(handlers, sourceFilePath));
      expect(preview.textLength).toBe(20_500);
      expect(preview.totalPages).toBe(3);
      expect(preview.chunkCount).toBe(2);

      const latestDuplicate = await Effect.runPromise(
        repository.findLatestBySourceFingerprint({
          sourceKind: "pdf",
          sourceFingerprint: `fp:${sourceFilePath}`,
        }),
      );
      expect(latestDuplicate).toBeNull();
    } finally {
      await dispose();
    }
  });

  it("previews chunk estimates for pasted text without creating a session", async () => {
    const { handlers, repository, dispose } = await setupHandlers();

    try {
      const preview = await Effect.runPromise(
        previewTextChunks(handlers, {
          text: "A".repeat(20_500),
          sourceLabel: "Pasted notes",
        }),
      );
      expect(preview.textLength).toBe(20_500);
      expect(preview.totalPages).toBe(1);
      expect(preview.chunkCount).toBe(2);

      const latestDuplicate = await Effect.runPromise(
        repository.findLatestBySourceFingerprint({
          sourceKind: "text",
          sourceFingerprint: createHash("sha256").update("A".repeat(20_500), "utf8").digest("hex"),
        }),
      );
      expect(latestDuplicate).toBeNull();
    } finally {
      await dispose();
    }
  });

  it("returns preview_empty_text when preview extraction is blank", async () => {
    const sourceFilePath = "/tmp/forge-preview-empty.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: " \n\t  ",
      },
    });
    const { handlers, dispose } = await setupHandlers({ extractor });

    try {
      const exit = await Effect.runPromiseExit(previewPdfChunks(handlers, sourceFilePath));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgePreviewChunks to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("preview_empty_text");
      }
    } finally {
      await dispose();
    }
  });

  it("returns source_resolve_error for unreadable preview PDFs", async () => {
    const sourceFilePath = "/tmp/forge-preview-failing.pdf";
    const extractor = createPdfExtractor({
      failingPaths: new Set([sourceFilePath]),
    });
    const { handlers, dispose } = await setupHandlers({ extractor });

    try {
      const exit = await Effect.runPromiseExit(previewPdfChunks(handlers, sourceFilePath));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgePreviewChunks to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("source_resolve_error");
      }
    } finally {
      await dispose();
    }
  });

  it("generates derived permutation cards and cloze and persists inline card edits", async () => {
    const promptRuntime = createCardsDomainPromptRuntime();
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const sourceFilePath = "/tmp/forge-cards-variants.pdf";
      const created = await Effect.runPromise(createPdfSession(handlers, sourceFilePath));

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk text",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await seedDetailTopics(repository, created.session.id, [
        { sequenceOrder: 0, topics: ["ATP"] },
      ]);
      const topicId = await getOnlyTopicId(repository, created.session.id);

      const generated = await Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          topicId,
        }),
      );
      const sourceCardId = generated.cards[0]?.id;
      if (!sourceCardId) {
        throw new Error("Expected generated source card.");
      }

      const permutations = unwrapDerivedCardsResult(
        await Effect.runPromise(
          handlers.ForgeGenerateDerivedCards({
            parent: { cardId: sourceCardId },
            kind: "permutation",
          }),
        ),
      );
      expect(permutations.derivations).toHaveLength(1);

      const cloze = await Effect.runPromise(
        handlers.ForgeGenerateCardCloze({ source: { cardId: sourceCardId } }),
      );
      expect(cloze.cloze).toContain("{{c1::ATP}}");
      const clozeWithQuestionOnlyOverride = await Effect.runPromise(
        handlers.ForgeGenerateCardCloze({
          source: { cardId: sourceCardId },
          sourceQuestion: "Question-only override",
        }),
      );
      expect(clozeWithQuestionOnlyOverride.cloze).toContain("{{c1::ATP}}");

      const updated = await Effect.runPromise(
        handlers.ForgeUpdateCard({
          cardId: sourceCardId,
          question: "Updated question?",
          answer: "Updated answer.",
        }),
      );
      expect(updated.card.question).toBe("Updated question?");

      const regeneratedPermutations = await Effect.runPromise(
        handlers.ForgeGenerateDerivedCards({
          parent: { cardId: sourceCardId },
          kind: "permutation",
        }),
      ).then((result) =>
        "confirmRequired" in result
          ? Effect.runPromise(
              handlers.ForgeGenerateDerivedCards({
                parent: { cardId: sourceCardId },
                kind: "permutation",
                confirmed: true,
              }),
            ).then(unwrapDerivedCardsResult)
          : result,
      );
      expect(regeneratedPermutations.derivations[0]?.question).toContain("Updated question?");
      expect(regeneratedPermutations.derivations[0]?.answer).toBe("Updated answer.");
      const regeneratedCloze = await Effect.runPromise(
        handlers.ForgeGenerateCardCloze({
          source: { cardId: sourceCardId },
          sourceQuestion: updated.card.question,
          sourceAnswer: updated.card.answer,
        }),
      );
      expect(regeneratedCloze.cloze).toContain("{{c1::Updated}}");

      const topicCards = await Effect.runPromise(
        handlers.ForgeGetTopicCards({
          sessionId: created.session.id,
          topicId: generated.topic.topicId,
        }),
      );
      expect(topicCards.cards[0]?.question).toBe("Updated question?");
    } finally {
      await dispose();
    }
  });

  it("reformulates a source card in place and prefers visible source overrides", async () => {
    let seenReformulateInput:
      | {
          readonly contextText: string;
          readonly source: { readonly question: string; readonly answer: string };
        }
      | undefined;
    const promptRuntime = createCardsDomainPromptRuntime({
      onReformulateCardInput: (input) => {
        seenReformulateInput = input;
      },
    });
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const created = await Effect.runPromise(
        createPdfSession(handlers, "/tmp/forge-reformulate-source.pdf"),
      );

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "ATP is the primary energy currency in cells.",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await seedDetailTopics(repository, created.session.id, [
        { sequenceOrder: 0, topics: ["ATP"] },
      ]);
      const topicId = await getOnlyTopicId(repository, created.session.id);

      const generated = await Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          topicId,
        }),
      );
      const sourceCardId = generated.cards[0]?.id;
      if (!sourceCardId) {
        throw new Error("Expected generated source card.");
      }

      const reformulated = await Effect.runPromise(
        handlers.ForgeReformulateCard({
          source: { cardId: sourceCardId },
          sourceQuestion: "How should ATP be remembered?",
          sourceAnswer: "As the cell's energy currency.",
        }),
      );

      expect("card" in reformulated).toBe(true);
      if ("card" in reformulated) {
        expect(reformulated.card.question).toBe("Rewritten: How should ATP be remembered?");
        expect(reformulated.card.answer).toBe("Rewritten: As the cell's energy currency.");
      }
      expect(seenReformulateInput).toEqual({
        contextText: "ATP is the primary energy currency in cells.",
        source: {
          question: "How should ATP be remembered?",
          answer: "As the cell's energy currency.",
        },
      });

      const topicCards = await Effect.runPromise(
        handlers.ForgeGetTopicCards({
          sessionId: created.session.id,
          topicId,
        }),
      );
      expect(topicCards.cards[0]).toMatchObject({
        id: sourceCardId,
        question: "Rewritten: How should ATP be remembered?",
        answer: "Rewritten: As the cell's energy currency.",
      });
    } finally {
      await dispose();
    }
  });

  it("updates a derivation's content and returns derivation_not_found for missing id", async () => {
    const promptRuntime = createCardsDomainPromptRuntime();
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const sourceFilePath = "/tmp/forge-update-permutation.pdf";
      const created = await Effect.runPromise(createPdfSession(handlers, sourceFilePath));

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk text",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await seedDetailTopics(repository, created.session.id, [
        { sequenceOrder: 0, topics: ["Permutation topic"] },
      ]);
      const topicId = await getOnlyTopicId(repository, created.session.id);

      const generated = await Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          topicId,
        }),
      );
      const sourceCardId = generated.cards[0]?.id;
      if (!sourceCardId) {
        throw new Error("Expected generated source card.");
      }

      const permutations = unwrapDerivedCardsResult(
        await Effect.runPromise(
          handlers.ForgeGenerateDerivedCards({
            parent: { cardId: sourceCardId },
            kind: "permutation",
          }),
        ),
      );
      expect(permutations.derivations).toHaveLength(1);
      const derivationId = permutations.derivations[0]!.id;

      const updated = await Effect.runPromise(
        handlers.ForgeUpdateDerivation({
          derivationId,
          question: "Updated derivation question?",
          answer: "Updated derivation answer.",
        }),
      );
      expect(updated.derivation.question).toBe("Updated derivation question?");
      expect(updated.derivation.answer).toBe("Updated derivation answer.");
      expect(updated.derivation.id).toBe(derivationId);

      const notFoundExit = await Effect.runPromiseExit(
        handlers.ForgeUpdateDerivation({
          derivationId: 999_999,
          question: "x",
          answer: "y",
        }),
      );
      expect(Exit.isFailure(notFoundExit)).toBe(true);
      if (Exit.isFailure(notFoundExit)) {
        const failure = Cause.failureOption(notFoundExit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect((failure.value as { readonly _tag: string })._tag).toBe("derivation_not_found");
        }
      }
    } finally {
      await dispose();
    }
  });

  it("reformulates a derivation in place and surfaces typed failures", async () => {
    const promptRuntime = createCardsDomainPromptRuntime();
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const created = await Effect.runPromise(
        createPdfSession(handlers, "/tmp/forge-reformulate-derivation.pdf"),
      );

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk text",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await seedDetailTopics(repository, created.session.id, [
        { sequenceOrder: 0, topics: ["Permutation topic"] },
      ]);
      const topicId = await getOnlyTopicId(repository, created.session.id);

      const generated = await Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          topicId,
        }),
      );
      const sourceCardId = generated.cards[0]?.id;
      if (!sourceCardId) {
        throw new Error("Expected generated source card.");
      }

      const permutations = unwrapDerivedCardsResult(
        await Effect.runPromise(
          handlers.ForgeGenerateDerivedCards({
            parent: { cardId: sourceCardId },
            kind: "permutation",
          }),
        ),
      );
      const derivationId = permutations.derivations[0]?.id;
      if (!derivationId) {
        throw new Error("Expected generated derivation.");
      }

      const reformulated = await Effect.runPromise(
        handlers.ForgeReformulateCard({
          source: { derivationId },
        }),
      );

      expect("derivation" in reformulated).toBe(true);
      if ("derivation" in reformulated) {
        expect(reformulated.derivation.question).toBe("Rewritten: Permutation of: What is ATP?");
        expect(reformulated.derivation.answer).toBe(
          "Rewritten: ATP is the cellular energy currency.",
        );
      }

      const derivedCards = await Effect.runPromise(
        handlers.ForgeGetDerivedCards({
          parent: { cardId: sourceCardId },
          kind: "permutation",
        }),
      );
      expect(derivedCards.derivations[0]).toMatchObject({
        id: derivationId,
        question: "Rewritten: Permutation of: What is ATP?",
        answer: "Rewritten: ATP is the cellular energy currency.",
      });

      const notFoundExit = await Effect.runPromiseExit(
        handlers.ForgeReformulateCard({
          source: { derivationId: 999_999 },
        }),
      );
      expect(Exit.isFailure(notFoundExit)).toBe(true);
      if (Exit.isFailure(notFoundExit)) {
        const failure = Cause.failureOption(notFoundExit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect((failure.value as { readonly _tag: string })._tag).toBe("derivation_not_found");
        }
      }
    } finally {
      await dispose();
    }
  });

  it("returns card_reformulation_error when reformulation prompt execution fails", async () => {
    const promptRuntime = createCardsDomainPromptRuntime({
      failReformulateCard: true,
    });
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const created = await Effect.runPromise(
        createPdfSession(handlers, "/tmp/forge-reformulate-failure.pdf"),
      );

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk text",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await seedDetailTopics(repository, created.session.id, [
        { sequenceOrder: 0, topics: ["ATP"] },
      ]);
      const topicId = await getOnlyTopicId(repository, created.session.id);

      const generated = await Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          topicId,
        }),
      );
      const sourceCardId = generated.cards[0]?.id;
      if (!sourceCardId) {
        throw new Error("Expected generated source card.");
      }

      const reformulationExit = await Effect.runPromiseExit(
        handlers.ForgeReformulateCard({
          source: { cardId: sourceCardId },
        }),
      );
      expect(Exit.isFailure(reformulationExit)).toBe(true);
      if (Exit.isFailure(reformulationExit)) {
        const failure = Cause.failureOption(reformulationExit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect((failure.value as { readonly _tag: string })._tag).toBe(
            "card_reformulation_error",
          );
        }
      }
    } finally {
      await dispose();
    }
  });

  it("builds root-first expansion ancestry without echoing the selected card in siblings", async () => {
    const seenExpansionInputs: Array<{
      readonly topic: string;
      readonly ancestryChain: ReadonlyArray<{
        readonly selectedCard: { readonly question: string; readonly answer: string };
        readonly siblingCards: ReadonlyArray<{
          readonly question: string;
          readonly answer: string;
        }>;
        readonly instruction?: string;
      }>;
      readonly instruction?: string;
    }> = [];
    const promptRuntime = createCardsDomainPromptRuntime({
      onGenerateExpansionsInput: (input) => {
        seenExpansionInputs.push(input);
      },
    });
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const created = await Effect.runPromise(
        createPdfSession(handlers, "/tmp/forge-expansion-ancestry.pdf"),
      );

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk text",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await seedDetailTopics(repository, created.session.id, [
        { sequenceOrder: 0, topics: ["Expansion ancestry topic"] },
      ]);

      const topic = await getTopicBySequenceOrderAndIndex(repository, created.session.id, 0, 0);
      if (!topic) throw new Error("Expected topic.");

      await Effect.runPromise(
        repository.replaceCardsForTopic({
          topicId: topic.topicId,
          cards: [
            { question: "Selected root?", answer: "Root answer." },
            { question: "Sibling one?", answer: "Sibling answer one." },
            { question: "Sibling two?", answer: "Sibling answer two." },
          ],
        }),
      );

      const topicCards = await getCardsForTopicBySequenceOrderAndIndex(
        repository,
        created.session.id,
        0,
        0,
      );
      const sourceCardId = topicCards?.cards[0]?.id;
      if (!sourceCardId) throw new Error("Expected root source card.");

      const firstExpansion = unwrapDerivedCardsResult(
        await Effect.runPromise(
          handlers.ForgeGenerateDerivedCards({
            parent: { cardId: sourceCardId },
            kind: "expansion",
            instruction: "root focus",
          }),
        ),
      );
      const firstExpansionId = firstExpansion.derivations[0]?.id;
      if (!firstExpansionId) throw new Error("Expected first expansion derivation id.");

      const nestedExpansion = unwrapDerivedCardsResult(
        await Effect.runPromise(
          handlers.ForgeGenerateDerivedCards({
            parent: { derivationId: firstExpansionId },
            kind: "expansion",
            instruction: "child focus",
          }),
        ),
      );

      expect(firstExpansion.derivations[0]?.kind).toBe("expansion");
      expect(nestedExpansion.derivations[0]?.parentDerivationId).toBe(firstExpansionId);
      expect(seenExpansionInputs).toHaveLength(2);
      expect(seenExpansionInputs[0]).toMatchObject({
        topic: "Expansion ancestry topic",
        ancestryChain: [
          {
            selectedCard: {
              question: "Selected root?",
              answer: "Root answer.",
            },
            siblingCards: [
              {
                question: "Sibling one?",
                answer: "Sibling answer one.",
              },
              {
                question: "Sibling two?",
                answer: "Sibling answer two.",
              },
            ],
          },
        ],
        instruction: "root focus",
      });
      expect(seenExpansionInputs[1]).toMatchObject({
        topic: "Expansion ancestry topic",
        ancestryChain: [
          {
            selectedCard: {
              question: "Selected root?",
              answer: "Root answer.",
            },
            siblingCards: [
              {
                question: "Sibling one?",
                answer: "Sibling answer one.",
              },
              {
                question: "Sibling two?",
                answer: "Sibling answer two.",
              },
            ],
          },
          {
            selectedCard: {
              question: "Expansion of: Selected root?",
              answer: "Root answer.",
            },
            siblingCards: [],
            instruction: "root focus",
          },
        ],
        instruction: "child focus",
      });
    } finally {
      await dispose();
    }
  });

  it("requires confirmation and cascades descendant derivation deletion when regenerating expansions", async () => {
    const promptRuntime = createCardsDomainPromptRuntime();
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const created = await Effect.runPromise(
        createPdfSession(handlers, "/tmp/forge-expansion-cascade.pdf"),
      );

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk text",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await seedDetailTopics(repository, created.session.id, [
        { sequenceOrder: 0, topics: ["Expansion cascade topic"] },
      ]);

      const topic = await getTopicBySequenceOrderAndIndex(repository, created.session.id, 0, 0);
      if (!topic) throw new Error("Expected topic.");

      await Effect.runPromise(
        repository.replaceCardsForTopic({
          topicId: topic.topicId,
          cards: [{ question: "Cascade root?", answer: "Cascade answer." }],
        }),
      );

      const topicCards = await getCardsForTopicBySequenceOrderAndIndex(
        repository,
        created.session.id,
        0,
        0,
      );
      const sourceCardId = topicCards?.cards[0]?.id;
      if (!sourceCardId) throw new Error("Expected root source card.");

      const rootExpansion = unwrapDerivedCardsResult(
        await Effect.runPromise(
          handlers.ForgeGenerateDerivedCards({
            parent: { cardId: sourceCardId },
            kind: "expansion",
          }),
        ),
      );
      const rootExpansionId = rootExpansion.derivations[0]?.id;
      if (!rootExpansionId) throw new Error("Expected root expansion derivation id.");

      const permutationFromExpansion = unwrapDerivedCardsResult(
        await Effect.runPromise(
          handlers.ForgeGenerateDerivedCards({
            parent: { derivationId: rootExpansionId },
            kind: "permutation",
          }),
        ),
      );
      const nestedExpansion = unwrapDerivedCardsResult(
        await Effect.runPromise(
          handlers.ForgeGenerateDerivedCards({
            parent: { derivationId: rootExpansionId },
            kind: "expansion",
          }),
        ),
      );

      expect(permutationFromExpansion.derivations).toHaveLength(1);
      expect(nestedExpansion.derivations).toHaveLength(1);

      const confirmation = await Effect.runPromise(
        handlers.ForgeGenerateDerivedCards({
          parent: { cardId: sourceCardId },
          kind: "expansion",
        }),
      );
      expect("confirmRequired" in confirmation).toBe(true);
      if (!("confirmRequired" in confirmation)) {
        throw new Error("Expected confirmation result.");
      }
      expect(confirmation.descendantCount).toBe(3);

      const regenerated = unwrapDerivedCardsResult(
        await Effect.runPromise(
          handlers.ForgeGenerateDerivedCards({
            parent: { cardId: sourceCardId },
            kind: "expansion",
            confirmed: true,
          }),
        ),
      );

      expect(regenerated.derivations).toHaveLength(1);
      expect(regenerated.derivations[0]?.id).not.toBe(rootExpansionId);

      const remainingPermutations = await Effect.runPromise(
        handlers.ForgeGetDerivedCards({
          parent: { derivationId: rootExpansionId },
          kind: "permutation",
        }),
      );
      const remainingExpansions = await Effect.runPromise(
        handlers.ForgeGetDerivedCards({
          parent: { derivationId: rootExpansionId },
          kind: "expansion",
        }),
      );

      expect(remainingPermutations.derivations).toEqual([]);
      expect(remainingExpansions.derivations).toEqual([]);
    } finally {
      await dispose();
    }
  });

  it("adds a QA card to a deck file", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-forge-add-qa-"));
    const deckPath = path.join(rootPath, "deck.md");
    const { handlers, dispose } = await setupHandlers();

    try {
      await fs.writeFile(deckPath, "", "utf8");
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const result = await Effect.runPromise(
        handlers.ForgeAddCardToDeck({
          deckPath,
          content: "What is ATP?\n---\nThe energy currency of cells.\n",
          cardType: "qa",
        }),
      );

      expect(result.cardIds).toHaveLength(1);
      const parsed = await Effect.runPromise(parseFile(await fs.readFile(deckPath, "utf8")));
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0]!.cards).toHaveLength(1);
      expect(parsed.items[0]!.cards[0]!.id).toBe(result.cardIds[0]);
      expect(parsed.items[0]!.content).toContain("What is ATP?");
      expect(parsed.items[0]!.content).toContain("The energy currency of cells.");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await dispose();
    }
  });

  it("persists card-added state for source cards when sourceCardId is provided", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-forge-add-mark-source-"));
    const deckPath = path.join(rootPath, "deck.md");
    const sourceFilePath = "/tmp/forge-mark-source.pdf";
    const { handlers, repository, dispose } = await setupHandlers();

    try {
      await fs.writeFile(deckPath, "", "utf8");
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const session = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "Test PDF",
          sourceFilePath,
          deckPath: null,
          sourceFingerprint: "fp:forge-mark-source",
        }),
      );
      await Effect.runPromise(
        repository.saveChunks(session.id, [
          {
            text: "chunk-0",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await seedDetailTopics(repository, session.id, [{ sequenceOrder: 0, topics: ["topic-a"] }]);

      const topic = await getTopicBySequenceOrderAndIndex(repository, session.id, 0, 0);
      if (!topic) throw new Error("Expected topic for source card.");

      await Effect.runPromise(
        repository.replaceCardsForTopic({
          topicId: topic.topicId,
          cards: [{ question: "What is ATP?", answer: "Cellular energy currency." }],
        }),
      );

      const detailBefore = await getCardsForTopicBySequenceOrderAndIndex(
        repository,
        session.id,
        0,
        0,
      );
      const sourceCardId = detailBefore?.cards[0]?.id;
      if (!sourceCardId) throw new Error("Expected source card id.");
      expect(detailBefore?.cards[0]?.addedToDeck).toBe(false);

      await Effect.runPromise(
        handlers.ForgeAddCardToDeck({
          deckPath,
          content: "What is ATP?\n---\nCellular energy currency.\n",
          cardType: "qa",
          sourceCardId,
        }),
      );

      const detailAfter = await getCardsForTopicBySequenceOrderAndIndex(
        repository,
        session.id,
        0,
        0,
      );
      expect(detailAfter?.cards[0]?.addedToDeck).toBe(true);

      const snapshot = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
      expect(snapshot[0]?.addedCount).toBe(1);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await dispose();
    }
  });

  it("increments derivation addedCount when adding with derivationId", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-forge-permutation-added-count-"));
    const deckPath = path.join(rootPath, "deck.md");
    const sourceFilePath = "/tmp/forge-permutation-added-count.pdf";
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime: createCardsDomainPromptRuntime(),
    });

    try {
      await fs.writeFile(deckPath, "", "utf8");
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const session = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "Test PDF",
          sourceFilePath,
          deckPath: null,
          sourceFingerprint: "fp:forge-permutation-added-count",
        }),
      );
      await Effect.runPromise(
        repository.saveChunks(session.id, [
          {
            text: "chunk-0",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await seedDetailTopics(repository, session.id, [{ sequenceOrder: 0, topics: ["topic-a"] }]);
      const topicId = await getOnlyTopicId(repository, session.id);

      const generated = await Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: session.id,
          topicId,
        }),
      );
      const sourceCardId = generated.cards[0]?.id;
      if (!sourceCardId) throw new Error("Expected source card id.");

      const permutations = unwrapDerivedCardsResult(
        await Effect.runPromise(
          handlers.ForgeGenerateDerivedCards({
            parent: { cardId: sourceCardId },
            kind: "permutation",
          }),
        ),
      );
      const derivationId = permutations.derivations[0]?.id;
      if (!derivationId) throw new Error("Expected derivation id.");
      expect(permutations.derivations[0]?.addedCount).toBe(0);

      await Effect.runPromise(
        handlers.ForgeAddCardToDeck({
          deckPath,
          content: "What molecule is the energy currency of the cell?\n---\nATP\n",
          cardType: "qa",
          derivationId,
        }),
      );

      const permutationsAfterAdd = await Effect.runPromise(
        handlers.ForgeGetDerivedCards({
          parent: { cardId: sourceCardId },
          kind: "permutation",
        }),
      );
      expect(permutationsAfterAdd.derivations[0]?.addedCount).toBe(1);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await dispose();
    }
  });

  it("fails when both sourceCardId and derivationId are provided", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-forge-add-card-conflict-"));
    const deckPath = path.join(rootPath, "deck.md");
    const { handlers, dispose } = await setupHandlers();

    try {
      await fs.writeFile(deckPath, "", "utf8");
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const exit = await Effect.runPromiseExit(
        handlers.ForgeAddCardToDeck({
          deckPath,
          content: "What is ATP?\n---\nCellular energy currency.\n",
          cardType: "qa",
          sourceCardId: 1,
          derivationId: 2,
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect((failure.value as { readonly _tag: string })._tag).toBe("forge_operation_error");
          expect((failure.value as { readonly message: string }).message).toContain(
            "Provide either sourceCardId or derivationId, not both.",
          );
        }
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await dispose();
    }
  });

  it("adds a cloze card to a deck file", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-forge-add-cloze-"));
    const deckPath = path.join(rootPath, "deck.md");
    const { handlers, dispose } = await setupHandlers();

    try {
      await fs.writeFile(deckPath, "", "utf8");
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const result = await Effect.runPromise(
        handlers.ForgeAddCardToDeck({
          deckPath,
          content: "The energy currency of cells is {{c1::ATP}}.",
          cardType: "cloze",
        }),
      );

      expect(result.cardIds).toHaveLength(1);
      const parsed = await Effect.runPromise(parseFile(await fs.readFile(deckPath, "utf8")));
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0]!.cards).toHaveLength(1);
      expect(parsed.items[0]!.content).toContain("{{c1::ATP}}");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await dispose();
    }
  });

  it("creates multiple card metadata entries for multi-index cloze", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-forge-add-multi-cloze-"));
    const deckPath = path.join(rootPath, "deck.md");
    const { handlers, dispose } = await setupHandlers();

    try {
      await fs.writeFile(deckPath, "", "utf8");
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const result = await Effect.runPromise(
        handlers.ForgeAddCardToDeck({
          deckPath,
          content: "{{c1::ATP}} is produced in {{c2::mitochondria}}.",
          cardType: "cloze",
        }),
      );

      expect(result.cardIds).toHaveLength(2);
      const parsed = await Effect.runPromise(parseFile(await fs.readFile(deckPath, "utf8")));
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0]!.cards).toHaveLength(2);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await dispose();
    }
  });

  it("increments cloze addedCount when adding cloze with sourceCardId", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-forge-cloze-added-count-"));
    const deckPath = path.join(rootPath, "deck.md");
    const sourceFilePath = "/tmp/forge-cloze-added-count.pdf";
    const { handlers, repository, dispose } = await setupHandlers();

    try {
      await fs.writeFile(deckPath, "", "utf8");
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const session = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "Test PDF",
          sourceFilePath,
          deckPath: null,
          sourceFingerprint: "fp:forge-cloze-added-count",
        }),
      );
      await Effect.runPromise(
        repository.saveChunks(session.id, [
          {
            text: "chunk-0",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await seedDetailTopics(repository, session.id, [{ sequenceOrder: 0, topics: ["topic-a"] }]);

      const topic = await getTopicBySequenceOrderAndIndex(repository, session.id, 0, 0);
      if (!topic) throw new Error("Expected topic for source card.");

      await Effect.runPromise(
        repository.replaceCardsForTopic({
          topicId: topic.topicId,
          cards: [{ question: "What is ATP?", answer: "Cellular energy currency." }],
        }),
      );

      const detail = await getCardsForTopicBySequenceOrderAndIndex(repository, session.id, 0, 0);
      const sourceCardId = detail?.cards[0]?.id;
      if (!sourceCardId) throw new Error("Expected source card id.");

      await Effect.runPromise(
        repository.upsertClozeForSource({
          source: { cardId: sourceCardId },
          clozeText: "{{c1::ATP}} is produced in {{c2::mitochondria}}.",
        }),
      );

      await Effect.runPromise(
        handlers.ForgeAddCardToDeck({
          deckPath,
          content: "{{c1::ATP}} is produced in {{c2::mitochondria}}.",
          cardType: "cloze",
          sourceCardId,
        }),
      );

      const cloze = await Effect.runPromise(repository.getClozeForSource({ cardId: sourceCardId }));
      expect(cloze?.addedCount).toBe(2);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await dispose();
    }
  });

  it("increments cloze addedCount when adding cloze with derivationId", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-forge-cloze-derivation-"));
    const deckPath = path.join(rootPath, "deck.md");
    const sourceFilePath = "/tmp/forge-cloze-derivation.pdf";
    const { handlers, repository, dispose } = await setupHandlers();

    try {
      await fs.writeFile(deckPath, "", "utf8");
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const session = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "Test PDF",
          sourceFilePath,
          deckPath: null,
          sourceFingerprint: "fp:forge-cloze-derivation",
        }),
      );
      await Effect.runPromise(
        repository.saveChunks(session.id, [
          {
            text: "chunk-0",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await seedDetailTopics(repository, session.id, [{ sequenceOrder: 0, topics: ["topic-a"] }]);

      const topic = await getTopicBySequenceOrderAndIndex(repository, session.id, 0, 0);
      if (!topic) throw new Error("Expected topic.");

      await Effect.runPromise(
        repository.replaceCardsForTopic({
          topicId: topic.topicId,
          cards: [{ question: "What is ATP?", answer: "Cellular energy." }],
        }),
      );

      const detail = await getCardsForTopicBySequenceOrderAndIndex(repository, session.id, 0, 0);
      const sourceCardId = detail?.cards[0]?.id;
      if (!sourceCardId) throw new Error("Expected source card id.");

      await Effect.runPromise(
        repository.replaceDerivedCards({
          parent: { cardId: sourceCardId },
          kind: "expansion",
          rootCardId: sourceCardId,
          instruction: null,
          cards: [{ question: "How is ATP made?", answer: "Via oxidative phosphorylation." }],
        }),
      );

      const derivations = await Effect.runPromise(
        repository.getDerivedCards({ parent: { cardId: sourceCardId }, kind: "expansion" }),
      );
      const derivationId = derivations[0]?.id;
      if (!derivationId) throw new Error("Expected derivation id.");

      await Effect.runPromise(
        repository.upsertClozeForSource({
          source: { derivationId },
          clozeText: "{{c1::ATP}} is made via {{c2::oxidative phosphorylation}}.",
        }),
      );

      await Effect.runPromise(
        handlers.ForgeAddCardToDeck({
          deckPath,
          content: "{{c1::ATP}} is made via {{c2::oxidative phosphorylation}}.",
          cardType: "cloze",
          derivationId,
        }),
      );

      const cloze = await Effect.runPromise(repository.getClozeForSource({ derivationId }));
      expect(cloze?.addedCount).toBe(2);

      const parsed = await Effect.runPromise(parseFile(await fs.readFile(deckPath, "utf8")));
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0]!.content).toContain("{{c2::oxidative phosphorylation}}");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await dispose();
    }
  });

  it("appends multiple cards to the same deck", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-forge-add-multi-"));
    const deckPath = path.join(rootPath, "deck.md");
    const { handlers, dispose } = await setupHandlers();

    try {
      await fs.writeFile(deckPath, "", "utf8");
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      await Effect.runPromise(
        handlers.ForgeAddCardToDeck({
          deckPath,
          content: "First Q?\n---\nFirst A\n",
          cardType: "qa",
        }),
      );
      await Effect.runPromise(
        handlers.ForgeAddCardToDeck({
          deckPath,
          content: "Second Q?\n---\nSecond A\n",
          cardType: "qa",
        }),
      );

      const parsed = await Effect.runPromise(parseFile(await fs.readFile(deckPath, "utf8")));
      expect(parsed.items).toHaveLength(2);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await dispose();
    }
  });

  it("fails with forge_operation_error for invalid QA content", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-forge-add-invalid-qa-"));
    const deckPath = path.join(rootPath, "deck.md");
    const { handlers, dispose } = await setupHandlers();

    try {
      await fs.writeFile(deckPath, "", "utf8");
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const exit = await Effect.runPromiseExit(
        handlers.ForgeAddCardToDeck({
          deckPath,
          content: "no separator here",
          cardType: "qa",
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect(failure.value._tag).toBe("forge_operation_error");
        }
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await dispose();
    }
  });

  it("fails with forge_operation_error for invalid cloze content", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-forge-add-invalid-cloze-"));
    const deckPath = path.join(rootPath, "deck.md");
    const { handlers, dispose } = await setupHandlers();

    try {
      await fs.writeFile(deckPath, "", "utf8");
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const exit = await Effect.runPromiseExit(
        handlers.ForgeAddCardToDeck({
          deckPath,
          content: "no cloze markers here",
          cardType: "cloze",
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect(failure.value._tag).toBe("forge_operation_error");
        }
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await dispose();
    }
  });

  it("rejects deck path outside workspace root", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-forge-add-root-"));
    const outsidePath = await fs.mkdtemp(path.join(tmpdir(), "re-forge-add-outside-"));
    const deckPath = path.join(outsidePath, "deck.md");
    const { handlers, dispose } = await setupHandlers();

    try {
      await fs.writeFile(deckPath, "", "utf8");
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const exit = await Effect.runPromiseExit(
        handlers.ForgeAddCardToDeck({
          deckPath,
          content: "Q?\n---\nA\n",
          cardType: "qa",
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect(failure.value._tag).toBe("forge_operation_error");
          expect(failure.value.message).toContain("outside workspace root");
        }
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(outsidePath, { recursive: true, force: true });
      await dispose();
    }
  });

  it("rejects when no workspace root is configured", async () => {
    const { handlers, dispose } = await setupHandlers();

    try {
      const exit = await Effect.runPromiseExit(
        handlers.ForgeAddCardToDeck({
          deckPath: "/some/deck.md",
          content: "Q?\n---\nA\n",
          cardType: "qa",
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect(failure.value._tag).toBe("forge_operation_error");
          expect(failure.value.message).toContain("root path is not configured");
        }
      }
    } finally {
      await dispose();
    }
  });

  it("appends to a deck with existing items without clobbering", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-forge-add-existing-"));
    const deckPath = path.join(rootPath, "deck.md");
    const { handlers, dispose } = await setupHandlers();

    try {
      await fs.writeFile(deckPath, "<!--@ existing-card 0 0 0 0-->\nOld Q?\n---\nOld A\n", "utf8");
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      await Effect.runPromise(
        handlers.ForgeAddCardToDeck({
          deckPath,
          content: "New Q?\n---\nNew A\n",
          cardType: "qa",
        }),
      );

      const parsed = await Effect.runPromise(parseFile(await fs.readFile(deckPath, "utf8")));
      expect(parsed.items).toHaveLength(2);
      expect(parsed.items[0]!.cards[0]!.id).toBe("existing-card");
      expect(parsed.items[0]!.content).toContain("Old Q?");
      expect(parsed.items[1]!.content).toContain("New Q?");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await dispose();
    }
  });

  it("returns mixed-family groups and outcomes from ForgeStartTopicExtraction", async () => {
    const sourceFilePath = "/tmp/forge-v2-start.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: "Alpha topic text. Beta topic text.",
      },
    });
    const promptRuntime = createPromptRuntime(({ chunkText, sourceText }) =>
      Effect.succeed([(chunkText ?? sourceText ?? "").slice(0, 5), "cross-source idea"]),
    );
    const { handlers, dispose } = await setupHandlers({
      extractor,
      promptRuntime,
    });

    try {
      const result = await Effect.runPromise(startPdfTopicExtraction(handlers, { sourceFilePath }));

      expect(result.session.status).toBe("topics_extracted");
      expect(result.outcomes).toEqual([
        {
          family: "detail",
          status: "extracted",
          errorMessage: null,
        },
        {
          family: "synthesis",
          status: "extracted",
          errorMessage: null,
        },
      ]);
      expect(result.groups).toHaveLength(2);
      expect(result.groups[0]?.groupKind).toBe("chunk");
      expect(result.groups[0]?.family).toBe("detail");
      expect(result.groups[0]?.topics).toHaveLength(2);
      expect(result.groups[0]?.topics[0]?.sessionId).toBe(result.session.id);
      expect(result.groups[1]?.groupKind).toBe("section");
      expect(result.groups[1]?.family).toBe("synthesis");
      expect(result.groups[1]?.topics).toHaveLength(2);
    } finally {
      await dispose();
    }
  });

  it("keeps session usable when synthesis extraction fails but detail succeeds in V2", async () => {
    const sourceFilePath = "/tmp/forge-v2-detail-success.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: "Alpha topic text. Beta topic text.",
      },
    });
    const promptRuntime = createPromptRuntime(({ chunkText, sourceText }) => {
      if (sourceText) {
        return Effect.fail(
          new PromptOutputParseError({
            promptId: "forge/get-synthesis-topics",
            message: "synthesis parse failure",
            rawExcerpt: "invalid",
          }),
        );
      }

      return Effect.succeed([(chunkText ?? "").slice(0, 5), "detail idea"]);
    });
    const { handlers, dispose } = await setupHandlers({
      extractor,
      promptRuntime,
    });

    try {
      const result = await Effect.runPromise(startPdfTopicExtraction(handlers, { sourceFilePath }));

      expect(result.session.status).toBe("topics_extracted");
      expect(result.outcomes).toEqual([
        {
          family: "detail",
          status: "extracted",
          errorMessage: null,
        },
        {
          family: "synthesis",
          status: "error",
          errorMessage: "synthesis parse failure",
        },
      ]);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0]?.family).toBe("detail");
    } finally {
      await dispose();
    }
  });

  it("fails V2 extraction when both detail and synthesis extraction fail", async () => {
    const sourceFilePath = "/tmp/forge-v2-all-fail.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: "Alpha topic text. Beta topic text.",
      },
    });
    const promptRuntime = createPromptRuntime(() =>
      Effect.fail(
        new PromptOutputParseError({
          promptId: "forge/get-topics",
          message: "all extraction failed",
          rawExcerpt: "invalid",
        }),
      ),
    );
    const { handlers, repository, dispose } = await setupHandlers({
      extractor,
      promptRuntime,
    });

    try {
      const exit = await Effect.runPromiseExit(
        startPdfTopicExtraction(handlers, { sourceFilePath }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgeStartTopicExtraction to fail.");
      }

      const sessions = await Effect.runPromise(repository.listRecentSessions());
      expect(sessions[0]?.status).toBe("error");
    } finally {
      await dispose();
    }
  });

  it("returns V2 cards snapshot rows with detail family metadata", async () => {
    const promptRuntime = createCardsDomainPromptRuntime();
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const created = await Effect.runPromise(
        createPdfSession(handlers, "/tmp/forge-v2-snapshot.pdf"),
      );

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk text",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await seedDetailTopics(repository, created.session.id, [
        { sequenceOrder: 0, topics: ["ATP"] },
      ]);
      const topicId = await getOnlyTopicId(repository, created.session.id);
      await Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          topicId,
        }),
      );

      const snapshot = await Effect.runPromise(
        handlers.ForgeGetCardsSnapshot({ sessionId: created.session.id }),
      );

      expect(snapshot.topics).toHaveLength(1);
      expect(snapshot.topics[0]?.family).toBe("detail");
      expect(snapshot.topics[0]?.sessionId).toBe(created.session.id);
      expect(snapshot.topics[0]?.chunkId).toBe(1);
      expect(snapshot.topics[0]?.chunkSequenceOrder).toBe(0);
    } finally {
      await dispose();
    }
  });

  it("generates synthesis cards through ForgeGenerateTopicCards", async () => {
    const promptRuntime = createCardsDomainPromptRuntime();
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const created = await Effect.runPromise(
        createPdfSession(handlers, "/tmp/forge-v2-synthesis-cards.pdf"),
      );

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk a ",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
          {
            text: "chunk b",
            sequenceOrder: 1,
            pageBoundaries: [{ offset: 0, page: 2 }],
          },
        ]),
      );
      await Effect.runPromise(
        repository.replaceSynthesisTopicsForSessionAndSetExtractionOutcome({
          sessionId: created.session.id,
          topics: ["synthesis topic"],
          status: "extracted",
          errorMessage: null,
        }),
      );

      const snapshot = await Effect.runPromise(
        handlers.ForgeGetCardsSnapshot({ sessionId: created.session.id }),
      );
      const topicId = snapshot.topics.find((topic) => topic.family === "synthesis")?.topicId;
      if (!topicId) {
        throw new Error("Expected synthesis topic id.");
      }

      const result = await Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          topicId,
        }),
      );

      expect(result.topic.family).toBe("synthesis");
      expect(result.cards.length).toBeGreaterThan(0);
    } finally {
      await dispose();
    }
  });

  it("rejects cross-session topicId access in ForgeGetTopicCards", async () => {
    const promptRuntime = createCardsDomainPromptRuntime();
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const first = await Effect.runPromise(
        createPdfSession(handlers, "/tmp/forge-v2-cross-a.pdf"),
      );
      const second = await Effect.runPromise(
        createPdfSession(handlers, "/tmp/forge-v2-cross-b.pdf"),
      );

      await Effect.runPromise(
        repository.saveChunks(second.session.id, [
          {
            text: "chunk second",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await seedDetailTopics(repository, second.session.id, [
        { sequenceOrder: 0, topics: ["topic second"] },
      ]);

      const snapshot = await Effect.runPromise(
        handlers.ForgeGetCardsSnapshot({ sessionId: second.session.id }),
      );
      const foreignTopicId = snapshot.topics[0]?.topicId;
      if (!foreignTopicId) {
        throw new Error("Expected topic id in second session.");
      }

      const exit = await Effect.runPromiseExit(
        handlers.ForgeGetTopicCards({
          sessionId: first.session.id,
          topicId: foreignTopicId,
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
    } finally {
      await dispose();
    }
  });

  it("rejects ForgeSaveTopicSelections for missing sessions", async () => {
    const { handlers, dispose } = await setupHandlers();

    try {
      const exit = await Effect.runPromiseExit(
        handlers.ForgeSaveTopicSelections({
          sessionId: 999,
          topicIds: [1],
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
    } finally {
      await dispose();
    }
  });

  it("generates permutations and cloze for synthesis-derived cards", async () => {
    const promptRuntime = createCardsDomainPromptRuntime();
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const created = await Effect.runPromise(
        createPdfSession(handlers, "/tmp/forge-v2-synthesis-variants.pdf"),
      );

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk a ",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
          {
            text: "chunk b",
            sequenceOrder: 1,
            pageBoundaries: [{ offset: 0, page: 2 }],
          },
        ]),
      );
      await Effect.runPromise(
        repository.replaceSynthesisTopicsForSessionAndSetExtractionOutcome({
          sessionId: created.session.id,
          topics: ["synthesis topic"],
          status: "extracted",
          errorMessage: null,
        }),
      );

      const snapshot = await Effect.runPromise(
        handlers.ForgeGetCardsSnapshot({ sessionId: created.session.id }),
      );
      const topicId = snapshot.topics.find((topic) => topic.family === "synthesis")?.topicId;
      if (!topicId) {
        throw new Error("Expected synthesis topic id.");
      }

      const generated = await Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          topicId,
        }),
      );
      const sourceCardId = generated.cards[0]?.id;
      if (!sourceCardId) {
        throw new Error("Expected synthesis source card.");
      }

      const permutations = unwrapDerivedCardsResult(
        await Effect.runPromise(
          handlers.ForgeGenerateDerivedCards({
            parent: { cardId: sourceCardId },
            kind: "permutation",
          }),
        ),
      );
      expect(permutations.derivations).toHaveLength(1);

      const cloze = await Effect.runPromise(
        handlers.ForgeGenerateCardCloze({
          source: { cardId: sourceCardId },
        }),
      );
      expect(cloze.cloze).toContain("{{c1::");
    } finally {
      await dispose();
    }
  });

  it("supports topic-id based cards access and selection through V2 handlers", async () => {
    const promptRuntime = createCardsDomainPromptRuntime();
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const created = await Effect.runPromise(
        createPdfSession(handlers, "/tmp/forge-v2-topic-id.pdf"),
      );

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk a",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
          {
            text: "chunk b",
            sequenceOrder: 1,
            pageBoundaries: [{ offset: 0, page: 2 }],
          },
        ]),
      );
      await seedDetailTopics(repository, created.session.id, [
        { sequenceOrder: 0, topics: ["topic a"] },
        { sequenceOrder: 1, topics: ["topic b"] },
      ]);

      const initialSnapshot = await Effect.runPromise(
        handlers.ForgeGetCardsSnapshot({ sessionId: created.session.id }),
      );
      const firstTopicId = initialSnapshot.topics[0]?.topicId;
      const secondTopicId = initialSnapshot.topics[1]?.topicId;

      if (!firstTopicId || !secondTopicId) {
        throw new Error("Expected two topic ids in V2 snapshot.");
      }

      await Effect.runPromise(
        handlers.ForgeSaveTopicSelections({
          sessionId: created.session.id,
          topicIds: [secondTopicId],
        }),
      );

      const selectedSnapshot = await Effect.runPromise(
        handlers.ForgeGetCardsSnapshot({ sessionId: created.session.id }),
      );
      expect(
        selectedSnapshot.topics.find((topic) => topic.topicId === firstTopicId)?.selected,
      ).toBe(false);
      expect(
        selectedSnapshot.topics.find((topic) => topic.topicId === secondTopicId)?.selected,
      ).toBe(true);

      const generated = await Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          topicId: secondTopicId,
        }),
      );
      expect(generated.topic.topicId).toBe(secondTopicId);
      expect(generated.cards.length).toBeGreaterThan(0);

      const reread = await Effect.runPromise(
        handlers.ForgeGetTopicCards({
          sessionId: created.session.id,
          topicId: secondTopicId,
        }),
      );
      expect(reread.topic.topicId).toBe(secondTopicId);
      expect(reread.cards.length).toBeGreaterThan(0);
    } finally {
      await dispose();
    }
  });
});
