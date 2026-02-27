import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

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
import { ForgeTopicChunkExtracted } from "@shared/rpc/contracts";

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

  it("returns the latest topic snapshot for a source path", async () => {
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
          sourceFilePath,
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
      readonly sourceFilePath: string;
      readonly sessionId: number;
      readonly chunk: {
        readonly chunkId: number;
        readonly sequenceOrder: number;
        readonly topics: readonly string[];
      };
    }> = [];

    const publish = vi.fn().mockImplementation((event: unknown, payload: unknown) => {
      if (event === ForgeTopicChunkExtracted) {
        publishedChunks.push(
          payload as {
            readonly sourceFilePath: string;
            readonly sessionId: number;
            readonly chunk: {
              readonly chunkId: number;
              readonly sequenceOrder: number;
              readonly topics: readonly string[];
            };
          },
        );
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

      expect(publishedChunks).toHaveLength(2);
      expect(publishedChunks.every((entry) => entry.sourceFilePath === sourceFilePath)).toBe(true);
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
});
