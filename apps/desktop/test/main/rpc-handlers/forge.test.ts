import * as fs from "node:fs/promises";
import * as path from "node:path";
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
import { AiCompletionError } from "@shared/rpc/schemas/ai";
import type { ForgeChunkPageBoundary } from "@shared/rpc/schemas/forge";
import { ForgeTopicChunkExtracted, ForgeExtractionSessionCreated } from "@shared/rpc/contracts";

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
    readonly chunkText: string;
    readonly maxTopics: number;
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
    run(input as { readonly chunkText: string; readonly maxTopics: number }).pipe(
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
}): ForgePromptRuntime => ({
  run: <Input, Output>(
    spec: PromptSpec<Input, Output>,
    _input: Input,
    runOptions?: PromptRunOptions,
  ) =>
    Effect.gen(function* () {
      if (spec.promptId === "forge/create-cards") {
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
        return {
          output: {
            permutations: [
              {
                question: "What molecule is the energy currency of the cell?",
                answer: "ATP",
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
        return {
          output: {
            cloze: "The energy currency of the cell is {{c1::ATP}}.",
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

      return yield* Effect.fail(
        new PromptInputValidationError({
          promptId: spec.promptId,
          message: "Unsupported prompt in test runtime.",
        }),
      );
    }),
});

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
      const result = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));

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
      const first = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));
      const second = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));

      expect(second.duplicateOfSessionId).toBe(first.session.id);
      expect(second.session.id).not.toBe(first.session.id);
      expect(second.session.sourceFingerprint).toBe(sourceFingerprint);
    } finally {
      await dispose();
    }
  });

  it("returns forge_operation_error when fingerprint resolution fails", async () => {
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
      const exit = await Effect.runPromiseExit(handlers.ForgeCreateSession({ sourceFilePath }));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgeCreateSession to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("forge_operation_error");
      }
    } finally {
      await dispose();
    }
  });

  it("rejects relative source paths at handler boundary", async () => {
    const { handlers, dispose } = await setupHandlers();

    try {
      const exit = await Effect.runPromiseExit(
        handlers.ForgeCreateSession({ sourceFilePath: "./relative.pdf" }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgeCreateSession to fail for relative paths.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("forge_operation_error");
      }
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
      await Effect.runPromise(
        repository.replaceTopicsForChunk({
          sessionId: sessionA.id,
          sequenceOrder: 0,
          topics: ["alpha", "beta"],
        }),
      );
      await Effect.runPromise(
        repository.saveTopicSelections({
          sessionId: sessionA.id,
          selections: [
            { chunkId: 1, topicIndex: 0 },
            { chunkId: 1, topicIndex: 1 },
          ],
        }),
      );

      const topic = await Effect.runPromise(
        repository.getTopicByRef({ sessionId: sessionA.id, chunkId: 1, topicIndex: 0 }),
      );
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
      const created = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));
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
      const created = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));
      const extracted = await Effect.runPromise(
        handlers.ForgeExtractText({ sessionId: created.session.id }),
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
      const created = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));
      const exit = await Effect.runPromiseExit(
        handlers.ForgeExtractText({ sessionId: created.session.id }),
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
      const created = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));
      const exit = await Effect.runPromiseExit(
        handlers.ForgeExtractText({ sessionId: created.session.id }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgeExtractText to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("pdf_extraction_error");
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
      const created = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));
      const exit = await Effect.runPromiseExit(
        handlers.ForgeExtractText({ sessionId: created.session.id }),
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
      const created = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));
      await Effect.runPromise(handlers.ForgeExtractText({ sessionId: created.session.id }));

      const retryExit = await Effect.runPromiseExit(
        handlers.ForgeExtractText({ sessionId: created.session.id }),
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
      const created = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));
      await Effect.runPromise(
        repository.setSessionStatus({
          sessionId: created.session.id,
          status: "extracting",
          errorMessage: null,
        }),
      );

      const exit = await Effect.runPromiseExit(
        handlers.ForgeExtractText({ sessionId: created.session.id }),
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
      const preview = await Effect.runPromise(handlers.ForgePreviewChunks({ sourceFilePath }));
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

  it("returns preview_empty_text when preview extraction is blank", async () => {
    const sourceFilePath = "/tmp/forge-preview-empty.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: " \n\t  ",
      },
    });
    const { handlers, dispose } = await setupHandlers({ extractor });

    try {
      const exit = await Effect.runPromiseExit(handlers.ForgePreviewChunks({ sourceFilePath }));
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

  it("returns preview_pdf_extraction_error for unreadable preview PDFs", async () => {
    const sourceFilePath = "/tmp/forge-preview-failing.pdf";
    const extractor = createPdfExtractor({
      failingPaths: new Set([sourceFilePath]),
    });
    const { handlers, dispose } = await setupHandlers({ extractor });

    try {
      const exit = await Effect.runPromiseExit(handlers.ForgePreviewChunks({ sourceFilePath }));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgePreviewChunks to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("preview_pdf_extraction_error");
      }
    } finally {
      await dispose();
    }
  });

  it("runs start-topic-extraction from session creation through persisted topics", async () => {
    const sourceFilePath = "/tmp/forge-start-success.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: "cell membrane nucleus mitochondria",
      },
      pageBreaksByPath: {
        [sourceFilePath]: [{ offset: 0, page: 1 }],
      },
      totalPagesByPath: {
        [sourceFilePath]: 1,
      },
    });
    const promptRuntime = createPromptRuntime(({ chunkText }) =>
      Effect.succeed([chunkText.slice(0, 4), "biology"]),
    );
    const { handlers, repository, dispose } = await setupHandlers({
      extractor,
      promptRuntime,
    });

    try {
      const result = await Effect.runPromise(
        handlers.ForgeStartTopicExtraction({
          sourceFilePath,
          maxTopicsPerChunk: 3,
        }),
      );

      expect(result.duplicateOfSessionId).toBeNull();
      expect(result.session.status).toBe("topics_extracted");
      expect(result.extraction.chunkCount).toBe(1);
      expect(result.topicsByChunk).toHaveLength(1);
      expect(result.topicsByChunk[0]?.sequenceOrder).toBe(0);
      expect(result.topicsByChunk[0]?.topics).toEqual(["cell", "biology"]);

      const persistedTopics = await Effect.runPromise(
        repository.getTopicsBySession(result.session.id),
      );
      expect(persistedTopics).toEqual(result.topicsByChunk);
    } finally {
      await dispose();
    }
  });

  it("returns the topic snapshot for a session id", async () => {
    const sourceFilePath = "/tmp/forge-topic-snapshot.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: "snapshot content",
      },
    });
    const promptRuntime = createPromptRuntime(() => Effect.succeed(["topic-a", "topic-b"]));
    const { handlers, dispose } = await setupHandlers({
      extractor,
      promptRuntime,
    });

    try {
      const extracted = await Effect.runPromise(
        handlers.ForgeStartTopicExtraction({
          sourceFilePath,
        }),
      );

      const snapshot = await Effect.runPromise(
        handlers.ForgeGetTopicExtractionSnapshot({
          sessionId: extracted.session.id,
        }),
      );

      expect(snapshot.session).not.toBeNull();
      expect(snapshot.session?.id).toBe(extracted.session.id);
      expect(snapshot.topicsByChunk).toEqual(extracted.topicsByChunk);
    } finally {
      await dispose();
    }
  });

  it("publishes a ForgeTopicChunkExtracted event for each completed chunk", async () => {
    const sourceFilePath = "/tmp/forge-topic-events.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: `${"A".repeat(16_000)}${"B".repeat(48)}`,
      },
      pageBreaksByPath: {
        [sourceFilePath]: [
          { offset: 0, page: 1 },
          { offset: 16_000, page: 2 },
        ],
      },
      totalPagesByPath: {
        [sourceFilePath]: 2,
      },
    });
    const promptRuntime = createPromptRuntime(({ chunkText }) =>
      Effect.succeed(chunkText.startsWith("A") ? ["chunk-a"] : ["chunk-b"]),
    );

    const publishedChunks: Array<{
      readonly sessionId: number;
      readonly chunk: {
        readonly chunkId: number;
        readonly sequenceOrder: number;
        readonly topics: readonly string[];
      };
    }> = [];
    const publishedSessionCreated: Array<{ readonly sessionId: number }> = [];

    const publish = vi.fn().mockImplementation((event: unknown, payload: unknown) => {
      if (event === ForgeTopicChunkExtracted) {
        publishedChunks.push(
          payload as {
            readonly sessionId: number;
            readonly chunk: {
              readonly chunkId: number;
              readonly sequenceOrder: number;
              readonly topics: readonly string[];
            };
          },
        );
      }
      if (event === ForgeExtractionSessionCreated) {
        publishedSessionCreated.push(payload as { readonly sessionId: number });
      }
      return Effect.void;
    });

    const { handlers, dispose } = await setupHandlers({
      extractor,
      promptRuntime,
      publish,
    });

    try {
      await Effect.runPromise(
        handlers.ForgeStartTopicExtraction({
          sourceFilePath,
        }),
      );

      expect(publishedSessionCreated).toHaveLength(1);
      expect(publishedSessionCreated[0]!.sessionId).toBeGreaterThan(0);

      expect(publishedChunks).toHaveLength(2);
      const sessionIds = new Set(publishedChunks.map((entry) => entry.sessionId));
      expect(sessionIds.size).toBe(1);
      expect(sessionIds.has(publishedSessionCreated[0]!.sessionId)).toBe(true);
      expect(publishedChunks.map((entry) => entry.chunk.sequenceOrder).sort()).toEqual([0, 1]);
    } finally {
      await dispose();
    }
  });

  it("keeps chunks with empty topic arrays in topicsByChunk", async () => {
    const sourceFilePath = "/tmp/forge-start-empty-topic-chunk.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: `${"A".repeat(12_000)}${"B".repeat(32)}`,
      },
      pageBreaksByPath: {
        [sourceFilePath]: [
          { offset: 0, page: 1 },
          { offset: 12_000, page: 2 },
        ],
      },
      totalPagesByPath: {
        [sourceFilePath]: 2,
      },
    });
    const promptRuntime = createPromptRuntime(({ chunkText }) => {
      if (chunkText.startsWith("A")) {
        return Effect.succeed([]);
      }
      return Effect.succeed(["second-chunk-topic"]);
    });
    const { handlers, dispose } = await setupHandlers({
      extractor,
      promptRuntime,
    });

    try {
      const result = await Effect.runPromise(
        handlers.ForgeStartTopicExtraction({
          sourceFilePath,
        }),
      );

      expect(result.topicsByChunk).toHaveLength(2);
      expect(result.topicsByChunk[0]?.sequenceOrder).toBe(0);
      expect(result.topicsByChunk[0]?.topics).toEqual([]);
      expect(result.topicsByChunk[1]?.sequenceOrder).toBe(1);
      expect(result.topicsByChunk[1]?.topics).toEqual(["second-chunk-topic"]);
    } finally {
      await dispose();
    }
  });

  it("returns duplicateOfSessionId on start-topic-extraction while creating a fresh session", async () => {
    const sourceFilePath = "/tmp/forge-start-duplicate.pdf";
    const sourceFingerprint = "fingerprint-duplicate-start";
    const extractor = createPdfExtractor({
      fingerprintByPath: {
        [sourceFilePath]: sourceFingerprint,
      },
      textByPath: {
        [sourceFilePath]: "duplicate content",
      },
    });
    const promptRuntime = createPromptRuntime(() => Effect.succeed(["topic"]));
    const { handlers, dispose } = await setupHandlers({
      extractor,
      promptRuntime,
    });

    try {
      const first = await Effect.runPromise(
        handlers.ForgeStartTopicExtraction({
          sourceFilePath,
        }),
      );
      const second = await Effect.runPromise(
        handlers.ForgeStartTopicExtraction({
          sourceFilePath,
        }),
      );

      expect(second.duplicateOfSessionId).toBe(first.session.id);
      expect(second.session.id).not.toBe(first.session.id);
      expect(second.session.sourceFingerprint).toBe(sourceFingerprint);
    } finally {
      await dispose();
    }
  });

  it("fails with topic_extraction_error when chunk loading returns empty", async () => {
    const sourceFilePath = "/tmp/forge-zero-chunks.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: "text that should be chunked",
      },
    });
    const promptRuntime = createPromptRuntime(() => Effect.succeed(["topic"]));
    const chunkService: ChunkService = {
      chunkText: () => Effect.succeed({ chunks: [], chunkCount: 0 }),
    };
    const { handlers, repository, dispose } = await setupHandlers({
      extractor,
      promptRuntime,
      chunkService,
    });

    try {
      const exit = await Effect.runPromiseExit(
        handlers.ForgeStartTopicExtraction({
          sourceFilePath,
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgeStartTopicExtraction to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("topic_extraction_error");
        const sessionId =
          "sessionId" in failure.value && typeof failure.value.sessionId === "number"
            ? failure.value.sessionId
            : null;
        expect(sessionId).not.toBeNull();
        if (sessionId !== null) {
          const stored = await Effect.runPromise(repository.getSession(sessionId));
          expect(stored?.status).toBe("error");
        }
      }
    } finally {
      await dispose();
    }
  });

  it("marks session as error and keeps already-completed chunk topics when chunk N fails", async () => {
    const sourceFilePath = "/tmp/forge-start-partial-failure.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: `${"A".repeat(12_000)}${"B".repeat(80)}`,
      },
      pageBreaksByPath: {
        [sourceFilePath]: [
          { offset: 0, page: 1 },
          { offset: 12_000, page: 2 },
        ],
      },
      totalPagesByPath: {
        [sourceFilePath]: 2,
      },
    });
    const promptRuntime = createPromptRuntime(({ chunkText }) => {
      if (chunkText.startsWith("B")) {
        return Effect.sleep("30 millis").pipe(
          Effect.zipRight(
            Effect.fail(
              new PromptOutputParseError({
                promptId: "forge/get-topics",
                message: "second chunk parse failure",
                rawExcerpt: "invalid",
              }),
            ),
          ),
        );
      }

      return Effect.succeed(["first-chunk-topic"]);
    });
    const { handlers, repository, dispose } = await setupHandlers({
      extractor,
      promptRuntime,
    });

    try {
      const exit = await Effect.runPromiseExit(
        handlers.ForgeStartTopicExtraction({
          sourceFilePath,
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgeStartTopicExtraction to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("topic_extraction_error");
        if ("sessionId" in failure.value && typeof failure.value.sessionId === "number") {
          const stored = await Effect.runPromise(repository.getSession(failure.value.sessionId));
          expect(stored?.status).toBe("error");
          const persistedTopics = await Effect.runPromise(
            repository.getTopicsBySession(failure.value.sessionId),
          );
          expect(persistedTopics).toHaveLength(2);
          expect(
            persistedTopics.some((chunkTopics) => chunkTopics.topics.includes("first-chunk-topic")),
          ).toBe(true);
        }
      }
    } finally {
      await dispose();
    }
  });

  it("maps all prompt runtime error variants to topic_extraction_error", async () => {
    const sourceFilePath = "/tmp/forge-start-runtime-union.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: "runtime union text",
      },
    });

    const runtimeErrors = [
      new PromptInputValidationError({
        promptId: "forge/get-topics",
        message: "input invalid",
      }),
      new PromptOutputParseError({
        promptId: "forge/get-topics",
        message: "parse invalid",
        rawExcerpt: "bad json",
      }),
      new PromptOutputValidationError({
        promptId: "forge/get-topics",
        message: "schema invalid",
        rawExcerpt: '{"topics":1}',
      }),
      new PromptNormalizationError({
        promptId: "forge/get-topics",
        message: "normalization invalid",
      }),
      new PromptModelInvocationError({
        promptId: "forge/get-topics",
        model: "anthropic:claude-sonnet-4-20250514",
        attempt: 1,
        cause: new AiCompletionError({ message: "provider failed" }),
      }),
    ] as const;

    for (const runtimeError of runtimeErrors) {
      const promptRuntime = createPromptRuntime(() => Effect.fail(runtimeError));
      const { handlers, dispose } = await setupHandlers({
        extractor,
        promptRuntime,
      });

      try {
        const exit = await Effect.runPromiseExit(
          handlers.ForgeStartTopicExtraction({
            sourceFilePath,
          }),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isSuccess(exit)) {
          throw new Error("Expected ForgeStartTopicExtraction to fail.");
        }

        const failure = Cause.failureOption(exit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect(failure.value._tag).toBe("topic_extraction_error");
        }
      } finally {
        await dispose();
      }
    }
  });

  it("returns a typed session_not_found error", async () => {
    const { handlers, dispose } = await setupHandlers();

    try {
      const exit = await Effect.runPromiseExit(handlers.ForgeExtractText({ sessionId: 999 }));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ForgeExtractText to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("session_not_found");
      }
    } finally {
      await dispose();
    }
  });

  it("generates cards for a persisted topic and returns cards snapshot state", async () => {
    const promptRuntime = createCardsDomainPromptRuntime();
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const sourceFilePath = "/tmp/forge-cards-topic.pdf";
      const created = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk text",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await Effect.runPromise(
        repository.replaceTopicsForChunk({
          sessionId: created.session.id,
          sequenceOrder: 0,
          topics: ["ATP"],
        }),
      );

      const generated = await Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          chunkId: 1,
          topicIndex: 0,
        }),
      );

      expect(generated.topic.status).toBe("generated");
      expect(generated.cards).toHaveLength(2);

      const snapshot = await Effect.runPromise(
        handlers.ForgeGetCardsSnapshot({ sessionId: created.session.id }),
      );
      expect(snapshot.topics).toHaveLength(1);
      expect(snapshot.topics[0]?.cardCount).toBe(2);
      expect(snapshot.topics[0]?.status).toBe("generated");
    } finally {
      await dispose();
    }
  });

  it("returns topic_already_generating when two card generations race for the same topic", async () => {
    let resolveCreateCards: () => void = () => undefined;
    const holdCreateCards = new Promise<void>((resolve) => {
      resolveCreateCards = resolve;
    });

    const promptRuntime = createCardsDomainPromptRuntime({
      holdCreateCards,
    });
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const sourceFilePath = "/tmp/forge-cards-race.pdf";
      const created = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk text",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await Effect.runPromise(
        repository.replaceTopicsForChunk({
          sessionId: created.session.id,
          sequenceOrder: 0,
          topics: ["ATP"],
        }),
      );

      const first = Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          chunkId: 1,
          topicIndex: 0,
        }),
      );

      await expect
        .poll(async () => {
          const snapshot = await Effect.runPromise(
            repository.getCardsSnapshotBySession(created.session.id),
          );
          return snapshot[0]?.status ?? null;
        })
        .toBe("generating");

      const secondExit = await Effect.runPromiseExit(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          chunkId: 1,
          topicIndex: 0,
        }),
      );

      expect(Exit.isFailure(secondExit)).toBe(true);
      if (Exit.isSuccess(secondExit)) {
        throw new Error("Expected second generation to fail.");
      }
      const secondFailure = Cause.failureOption(secondExit.cause);
      expect(secondFailure._tag).toBe("Some");
      if (secondFailure._tag === "Some") {
        expect(secondFailure.value._tag).toBe("topic_already_generating");
      }

      resolveCreateCards();
      await first;
    } finally {
      await dispose();
    }
  });

  it("marks topic generation as error when card generation fails", async () => {
    const promptRuntime = createCardsDomainPromptRuntime({
      failCreateCards: true,
    });
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const sourceFilePath = "/tmp/forge-cards-failure.pdf";
      const created = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk text",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await Effect.runPromise(
        repository.replaceTopicsForChunk({
          sessionId: created.session.id,
          sequenceOrder: 0,
          topics: ["ATP"],
        }),
      );

      const failedGeneration = await Effect.runPromiseExit(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          chunkId: 1,
          topicIndex: 0,
        }),
      );

      expect(Exit.isFailure(failedGeneration)).toBe(true);
      if (Exit.isSuccess(failedGeneration)) {
        throw new Error("Expected topic card generation to fail.");
      }
      const failure = Cause.failureOption(failedGeneration.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("card_generation_error");
      }

      const snapshot = await Effect.runPromise(
        handlers.ForgeGetCardsSnapshot({ sessionId: created.session.id }),
      );
      expect(snapshot.topics).toHaveLength(1);
      expect(snapshot.topics[0]?.status).toBe("error");
      expect(snapshot.topics[0]?.cardCount).toBe(0);
      expect(snapshot.topics[0]?.errorMessage).toContain("create-cards parse failure");
    } finally {
      await dispose();
    }
  });

  it("generates selected topics in main with a bounded concurrency limit", async () => {
    let inFlightCreateCards = 0;
    let maxInFlightCreateCards = 0;

    const promptRuntime: ForgePromptRuntime = {
      run: <Input, Output>(
        spec: PromptSpec<Input, Output>,
        _input: Input,
        options?: PromptRunOptions,
      ) =>
        Effect.gen(function* () {
          if (spec.promptId !== "forge/create-cards") {
            return yield* Effect.fail(
              new PromptInputValidationError({
                promptId: spec.promptId,
                message: "Unsupported prompt in test runtime.",
              }),
            );
          }

          inFlightCreateCards += 1;
          maxInFlightCreateCards = Math.max(maxInFlightCreateCards, inFlightCreateCards);
          yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 25)));
          inFlightCreateCards -= 1;

          return {
            output: {
              cards: [{ question: "Q", answer: "A" }],
            } as unknown as Output,
            rawText: '{"cards":[{"question":"Q","answer":"A"}]}',
            metadata: {
              promptId: spec.promptId,
              promptVersion: "1",
              model: options?.model ?? "mock:model",
              attemptCount: 1,
              promptHash: "x".repeat(64),
              outputChars: 32,
            },
          };
        }),
    };

    const { handlers, repository, dispose } = await setupHandlers({ promptRuntime });

    try {
      const sourceFilePath = "/tmp/forge-cards-batch-concurrency.pdf";
      const created = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk one",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
          {
            text: "chunk two",
            sequenceOrder: 1,
            pageBoundaries: [{ offset: 10, page: 2 }],
          },
        ]),
      );
      await Effect.runPromise(
        repository.replaceTopicsForChunk({
          sessionId: created.session.id,
          sequenceOrder: 0,
          topics: ["topic a", "topic b"],
        }),
      );
      await Effect.runPromise(
        repository.replaceTopicsForChunk({
          sessionId: created.session.id,
          sequenceOrder: 1,
          topics: ["topic c", "topic d"],
        }),
      );

      const result = await Effect.runPromise(
        handlers.ForgeGenerateSelectedTopicCards({
          sessionId: created.session.id,
          topics: [
            { chunkId: 1, topicIndex: 0 },
            { chunkId: 1, topicIndex: 1 },
            { chunkId: 2, topicIndex: 0 },
            { chunkId: 2, topicIndex: 1 },
          ],
          concurrencyLimit: 2,
        }),
      );

      expect(result.results).toHaveLength(4);
      expect(result.results.every((entry) => entry.status === "generated")).toBe(true);
      expect(maxInFlightCreateCards).toBeLessThanOrEqual(2);

      const snapshot = await Effect.runPromise(
        handlers.ForgeGetCardsSnapshot({ sessionId: created.session.id }),
      );
      expect(snapshot.topics).toHaveLength(4);
      expect(snapshot.topics.every((topic) => topic.status === "generated")).toBe(true);
    } finally {
      await dispose();
    }
  });

  it("regenerates cards in batch for topics that already have cards", async () => {
    const promptRuntime = createCardsDomainPromptRuntime();
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const sourceFilePath = "/tmp/forge-cards-batch-regenerate.pdf";
      const created = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk text",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await Effect.runPromise(
        repository.replaceTopicsForChunk({
          sessionId: created.session.id,
          sequenceOrder: 0,
          topics: ["ATP"],
        }),
      );

      await Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          chunkId: 1,
          topicIndex: 0,
        }),
      );

      const firstSnapshot = await Effect.runPromise(
        handlers.ForgeGetCardsSnapshot({ sessionId: created.session.id }),
      );
      const firstRevision = firstSnapshot.topics[0]?.generationRevision;
      expect(typeof firstRevision).toBe("number");

      const batchResult = await Effect.runPromise(
        handlers.ForgeGenerateSelectedTopicCards({
          sessionId: created.session.id,
          topics: [{ chunkId: 1, topicIndex: 0 }],
          concurrencyLimit: 1,
        }),
      );
      expect(batchResult.results[0]?.status).toBe("generated");

      const secondSnapshot = await Effect.runPromise(
        handlers.ForgeGetCardsSnapshot({ sessionId: created.session.id }),
      );
      expect(secondSnapshot.topics[0]?.status).toBe("generated");
      expect(secondSnapshot.topics[0]?.generationRevision).toBe((firstRevision ?? 0) + 1);
      expect(secondSnapshot.topics[0]?.cardCount).toBeGreaterThan(0);
    } finally {
      await dispose();
    }
  });

  it("returns isolated per-topic statuses for already_generating, topic_not_found, typed errors, and defects", async () => {
    let resolveBusyTopicGeneration: () => void = () => undefined;
    const holdBusyTopicGeneration = new Promise<void>((resolve) => {
      resolveBusyTopicGeneration = resolve;
    });

    const promptRuntime: ForgePromptRuntime = {
      run: <Input, Output>(
        spec: PromptSpec<Input, Output>,
        input: Input,
        options?: PromptRunOptions,
      ) =>
        Effect.gen(function* () {
          if (spec.promptId !== "forge/create-cards") {
            return yield* Effect.fail(
              new PromptInputValidationError({
                promptId: spec.promptId,
                message: "Unsupported prompt in test runtime.",
              }),
            );
          }

          const createCardsInput = input as { readonly topic: string };
          if (createCardsInput.topic === "Busy topic") {
            yield* Effect.promise(() => holdBusyTopicGeneration);
          } else if (createCardsInput.topic === "Fail topic") {
            return yield* Effect.fail(
              new PromptOutputParseError({
                promptId: spec.promptId,
                message: "forced topic failure",
                rawExcerpt: "invalid",
              }),
            );
          } else if (createCardsInput.topic === "Defect topic") {
            return yield* Effect.die(new Error("defect in batch generation"));
          }

          return {
            output: {
              cards: [{ question: "Q", answer: "A" }],
            } as unknown as Output,
            rawText: '{"cards":[{"question":"Q","answer":"A"}]}',
            metadata: {
              promptId: spec.promptId,
              promptVersion: "1",
              model: options?.model ?? "mock:model",
              attemptCount: 1,
              promptHash: "x".repeat(64),
              outputChars: 32,
            },
          };
        }),
    };

    const { handlers, repository, dispose } = await setupHandlers({ promptRuntime });

    try {
      const sourceFilePath = "/tmp/forge-cards-batch-statuses.pdf";
      const created = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk text",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await Effect.runPromise(
        repository.replaceTopicsForChunk({
          sessionId: created.session.id,
          sequenceOrder: 0,
          topics: ["Busy topic", "Fail topic", "Defect topic"],
        }),
      );

      const busyGeneration = Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          chunkId: 1,
          topicIndex: 0,
        }),
      );

      await expect
        .poll(async () => {
          const snapshot = await Effect.runPromise(
            repository.getCardsSnapshotBySession(created.session.id),
          );
          return snapshot[0]?.status ?? null;
        })
        .toBe("generating");

      const batchResult = await Effect.runPromise(
        handlers.ForgeGenerateSelectedTopicCards({
          sessionId: created.session.id,
          topics: [
            { chunkId: 1, topicIndex: 0 },
            { chunkId: 1, topicIndex: 1 },
            { chunkId: 1, topicIndex: 2 },
            { chunkId: 999, topicIndex: 0 },
          ],
          concurrencyLimit: 2,
        }),
      );

      const resultByKey = new Map(
        batchResult.results.map(
          (entry) => [`${entry.chunkId}:${entry.topicIndex}`, entry] as const,
        ),
      );
      expect(resultByKey.get("1:0")?.status).toBe("already_generating");
      expect(resultByKey.get("1:0")?.message).toBeNull();
      expect(resultByKey.get("1:1")?.status).toBe("error");
      expect(resultByKey.get("1:1")?.message).toContain("forced topic failure");
      expect(resultByKey.get("1:2")?.status).toBe("error");
      expect(resultByKey.get("1:2")?.message).toContain("defect in batch generation");
      expect(resultByKey.get("999:0")?.status).toBe("topic_not_found");
      expect(resultByKey.get("999:0")?.message).toBeNull();

      resolveBusyTopicGeneration();
      await busyGeneration;
    } finally {
      await dispose();
    }
  });

  it("generates permutations and cloze and persists inline card edits", async () => {
    const promptRuntime = createCardsDomainPromptRuntime();
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const sourceFilePath = "/tmp/forge-cards-variants.pdf";
      const created = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk text",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await Effect.runPromise(
        repository.replaceTopicsForChunk({
          sessionId: created.session.id,
          sequenceOrder: 0,
          topics: ["ATP"],
        }),
      );

      const generated = await Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          chunkId: 1,
          topicIndex: 0,
        }),
      );
      const sourceCardId = generated.cards[0]?.id;
      if (!sourceCardId) {
        throw new Error("Expected generated source card.");
      }

      const permutations = await Effect.runPromise(
        handlers.ForgeGenerateCardPermutations({ sourceCardId }),
      );
      expect(permutations.permutations).toHaveLength(1);

      const cloze = await Effect.runPromise(handlers.ForgeGenerateCardCloze({ sourceCardId }));
      expect(cloze.cloze).toContain("{{c1::ATP}}");

      const updated = await Effect.runPromise(
        handlers.ForgeUpdateCard({
          cardId: sourceCardId,
          question: "Updated question?",
          answer: "Updated answer.",
        }),
      );
      expect(updated.card.question).toBe("Updated question?");

      const topicCards = await Effect.runPromise(
        handlers.ForgeGetTopicCards({
          sessionId: created.session.id,
          chunkId: 1,
          topicIndex: 0,
        }),
      );
      expect(topicCards.cards[0]?.question).toBe("Updated question?");
    } finally {
      await dispose();
    }
  });

  it("updates a permutation's content and returns permutation_not_found for missing id", async () => {
    const promptRuntime = createCardsDomainPromptRuntime();
    const { handlers, repository, dispose } = await setupHandlers({
      promptRuntime,
    });

    try {
      const sourceFilePath = "/tmp/forge-update-permutation.pdf";
      const created = await Effect.runPromise(handlers.ForgeCreateSession({ sourceFilePath }));

      await Effect.runPromise(
        repository.saveChunks(created.session.id, [
          {
            text: "chunk text",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await Effect.runPromise(
        repository.replaceTopicsForChunk({
          sessionId: created.session.id,
          sequenceOrder: 0,
          topics: ["Permutation topic"],
        }),
      );

      const generated = await Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: created.session.id,
          chunkId: 1,
          topicIndex: 0,
        }),
      );
      const sourceCardId = generated.cards[0]?.id;
      if (!sourceCardId) {
        throw new Error("Expected generated source card.");
      }

      const permutations = await Effect.runPromise(
        handlers.ForgeGenerateCardPermutations({ sourceCardId }),
      );
      expect(permutations.permutations).toHaveLength(1);
      const permutationId = permutations.permutations[0]!.id;

      const updated = await Effect.runPromise(
        handlers.ForgeUpdatePermutation({
          permutationId,
          question: "Updated permutation question?",
          answer: "Updated permutation answer.",
        }),
      );
      expect(updated.permutation.question).toBe("Updated permutation question?");
      expect(updated.permutation.answer).toBe("Updated permutation answer.");
      expect(updated.permutation.id).toBe(permutationId);

      const notFoundExit = await Effect.runPromiseExit(
        handlers.ForgeUpdatePermutation({
          permutationId: 999_999,
          question: "x",
          answer: "y",
        }),
      );
      expect(Exit.isFailure(notFoundExit)).toBe(true);
      if (Exit.isFailure(notFoundExit)) {
        const failure = Cause.failureOption(notFoundExit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect(failure.value._tag).toBe("permutation_not_found");
        }
      }
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
      await Effect.runPromise(
        repository.replaceTopicsForChunk({
          sessionId: session.id,
          sequenceOrder: 0,
          topics: ["topic-a"],
        }),
      );

      const topic = await Effect.runPromise(
        repository.getTopicByRef({ sessionId: session.id, chunkId: 1, topicIndex: 0 }),
      );
      if (!topic) throw new Error("Expected topic for source card.");

      await Effect.runPromise(
        repository.replaceCardsForTopic({
          topicId: topic.topicId,
          cards: [{ question: "What is ATP?", answer: "Cellular energy currency." }],
        }),
      );

      const detailBefore = await Effect.runPromise(
        repository.getCardsForTopicRef({ sessionId: session.id, chunkId: 1, topicIndex: 0 }),
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

      const detailAfter = await Effect.runPromise(
        repository.getCardsForTopicRef({ sessionId: session.id, chunkId: 1, topicIndex: 0 }),
      );
      expect(detailAfter?.cards[0]?.addedToDeck).toBe(true);

      const snapshot = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
      expect(snapshot[0]?.addedCount).toBe(1);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await dispose();
    }
  });

  it("increments permutation addedCount when adding with permutationId", async () => {
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
      await Effect.runPromise(
        repository.replaceTopicsForChunk({
          sessionId: session.id,
          sequenceOrder: 0,
          topics: ["topic-a"],
        }),
      );

      const generated = await Effect.runPromise(
        handlers.ForgeGenerateTopicCards({
          sessionId: session.id,
          chunkId: 1,
          topicIndex: 0,
        }),
      );
      const sourceCardId = generated.cards[0]?.id;
      if (!sourceCardId) throw new Error("Expected source card id.");

      const permutations = await Effect.runPromise(
        handlers.ForgeGenerateCardPermutations({ sourceCardId }),
      );
      const permutationId = permutations.permutations[0]?.id;
      if (!permutationId) throw new Error("Expected permutation id.");
      expect(permutations.permutations[0]?.addedCount).toBe(0);

      await Effect.runPromise(
        handlers.ForgeAddCardToDeck({
          deckPath,
          content:
            "What molecule is the energy currency of the cell?\n---\nATP\n",
          cardType: "qa",
          permutationId,
        }),
      );

      const permutationsAfterAdd = await Effect.runPromise(
        handlers.ForgeGetCardPermutations({ sourceCardId }),
      );
      expect(permutationsAfterAdd.permutations[0]?.addedCount).toBe(1);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await dispose();
    }
  });

  it("fails when both sourceCardId and permutationId are provided", async () => {
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
          permutationId: 2,
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect(failure.value._tag).toBe("forge_operation_error");
          expect(failure.value.message).toContain(
            "Provide either sourceCardId or permutationId, not both.",
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
      await Effect.runPromise(
        repository.replaceTopicsForChunk({
          sessionId: session.id,
          sequenceOrder: 0,
          topics: ["topic-a"],
        }),
      );

      const topic = await Effect.runPromise(
        repository.getTopicByRef({ sessionId: session.id, chunkId: 1, topicIndex: 0 }),
      );
      if (!topic) throw new Error("Expected topic for source card.");

      await Effect.runPromise(
        repository.replaceCardsForTopic({
          topicId: topic.topicId,
          cards: [{ question: "What is ATP?", answer: "Cellular energy currency." }],
        }),
      );

      const detail = await Effect.runPromise(
        repository.getCardsForTopicRef({ sessionId: session.id, chunkId: 1, topicIndex: 0 }),
      );
      const sourceCardId = detail?.cards[0]?.id;
      if (!sourceCardId) throw new Error("Expected source card id.");

      await Effect.runPromise(
        repository.upsertClozeForCard({
          sourceCardId,
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

      const cloze = await Effect.runPromise(repository.getClozeForCard(sourceCardId));
      expect(cloze?.addedCount).toBe(2);
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
});
