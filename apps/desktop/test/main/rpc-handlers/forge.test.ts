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
import {
  PdfFingerprintResolveError,
  PdfTextExtractError,
  type PdfExtractor,
} from "@main/forge/services/pdf-extractor";
import type { ForgeChunkPageBoundary } from "@shared/rpc/schemas/forge";

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

describe("forge handlers", () => {
  const setupHandlers = async (
    overrides: {
      readonly repository?: ForgeSessionRepository;
      readonly extractor?: PdfExtractor;
    } = {},
  ) => {
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-forge-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const repository = overrides.repository ?? makeInMemoryForgeSessionRepository();
    const extractor = overrides.extractor ?? createPdfExtractor();
    const handlers = await createHandlersWithOverrides(settingsFilePath, {
      forgeSessionRepository: repository,
      pdfExtractor: extractor,
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
