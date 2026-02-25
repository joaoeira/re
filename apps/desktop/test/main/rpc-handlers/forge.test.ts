import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  makeInMemoryForgeSessionRepository,
  ForgeSessionRepositoryError,
  ForgeSessionStatusTransitionError,
  type ForgeSessionRepository,
} from "@main/forge/services/forge-session-repository";
import {
  PdfFingerprintResolveError,
  PdfTextExtractError,
  type PdfExtractor,
} from "@main/forge/services/pdf-extractor";

import { createHandlersWithOverrides } from "./helpers";

const createPdfExtractor = (options?: {
  readonly fingerprintByPath?: Record<string, string>;
  readonly textByPath?: Record<string, string>;
  readonly failingPaths?: ReadonlySet<string>;
}): PdfExtractor => {
  const fingerprintByPath = options?.fingerprintByPath ?? {};
  const textByPath = options?.textByPath ?? {};
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

      return Effect.succeed(textByPath[sourceFilePath] ?? "default extracted text");
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

      const stored = await Effect.runPromise(repository.getSessionById(result.session.id));
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
      extractText: () => Effect.succeed(""),
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

  it("updates status to extracted and returns preview + length", async () => {
    const sourceFilePath = "/tmp/forge-extract.pdf";
    const extractedText = "a".repeat(2500);
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: extractedText,
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
      expect(extracted.preview.length).toBe(2000);
      expect(extracted.preview).toBe(extractedText.slice(0, 2000));
      expect(consoleSpy).toHaveBeenCalledWith("[forge/extract]", {
        sessionId: created.session.id,
        textLength: extractedText.length,
      });

      const stored = await Effect.runPromise(repository.getSessionById(created.session.id));
      expect(stored?.status).toBe("extracted");
      expect(stored?.errorMessage).toBeNull();
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
      updateSessionStatus: ({ sessionId, status, errorMessage }) => {
        if (status === "extracted") {
          return Effect.fail(
            new ForgeSessionRepositoryError({
              operation: "updateSessionStatus",
              message: "Simulated extracted-status write failure",
            }),
          );
        }

        return baseRepository.updateSessionStatus({ sessionId, status, errorMessage });
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

      const stored = await Effect.runPromise(repository.getSessionById(created.session.id));
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
        expect(failure.value._tag).toBe("forge_operation_error");
      }

      const stored = await Effect.runPromise(repository.getSessionById(created.session.id));
      expect(stored?.status).toBe("error");
      expect(stored?.errorMessage).toContain(sourceFilePath);
    } finally {
      consoleSpy.mockRestore();
      await dispose();
    }
  });

  it("does not downgrade extracted sessions to error on invalid extraction retries", async () => {
    const sourceFilePath = "/tmp/forge-retry-invalid-transition.pdf";
    const extractor = createPdfExtractor({
      textByPath: {
        [sourceFilePath]: "retry test text",
      },
    });
    const { handlers, repository, dispose } = await setupHandlers({ extractor });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

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

      const stored = await Effect.runPromise(repository.getSessionById(created.session.id));
      expect(stored?.status).toBe("extracted");
      expect(stored?.errorMessage).toBeNull();
    } finally {
      consoleSpy.mockRestore();
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

  it("rejects invalid status transitions at the repository boundary", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
        sourceFilePath: "/tmp/forge-transition.pdf",
        deckPath: null,
        sourceFingerprint: "fp-transition",
      }),
    );

    const exit = await Effect.runPromiseExit(
      repository.updateSessionStatus({
        sessionId: session.id,
        status: "ready",
        errorMessage: null,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected invalid transition to fail.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag === "Some") {
      expect(failure.value).toBeInstanceOf(ForgeSessionStatusTransitionError);
    }
  });

  it("allows ready to generating transitions", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
        sourceFilePath: "/tmp/forge-ready-cycle.pdf",
        deckPath: null,
        sourceFingerprint: "fp-ready-cycle",
      }),
    );

    const transitions = [
      "extracting",
      "extracted",
      "topics_extracting",
      "topics_extracted",
      "generating",
      "ready",
      "generating",
    ] as const;

    let current = session;
    for (const status of transitions) {
      const updated = await Effect.runPromise(
        repository.updateSessionStatus({
          sessionId: current.id,
          status,
          errorMessage: null,
        }),
      );

      if (!updated) {
        throw new Error("Session disappeared during transition test.");
      }
      current = updated;
    }

    expect(current.status).toBe("generating");
  });
});
