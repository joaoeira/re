import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { Cause, Effect, Exit } from "effect";
import { safeStorage } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NodeServicesLive } from "@main/effect/node-services";
import { makeSecretStore } from "@main/secrets";
import type { SecretStore } from "@main/secrets/secret-store";
import {
  SecretDecryptionFailed,
  SecretNotFound,
  SecretStoreReadFailed,
  SecretStoreUnavailable,
  SecretStoreWriteFailed,
} from "@shared/secrets";

const makeStore = (encryptedFilePath: string) =>
  makeSecretStore({ encryptedFilePath }).pipe(Effect.provide(NodeServicesLive), Effect.runPromise);

const withTempSecretsDir = async <T>(
  run: (context: { readonly encryptedFilePath: string }) => Promise<T>,
): Promise<T> => {
  const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-secret-store-"));
  const encryptedFilePath = path.join(rootPath, "secrets.json");

  try {
    return await run({ encryptedFilePath });
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
};

const extractFailure = <A, E>(exit: Exit.Exit<A, E>): E => {
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected Effect to fail.");
  }

  const failure = Cause.failureOption(exit.cause);
  expect(failure._tag).toBe("Some");

  if (failure._tag === "None") {
    throw new Error("Expected a typed failure.");
  }

  return failure.value;
};

const makeSystemError = (
  reason: "NotFound" | "PermissionDenied",
  method: string,
  pathOrDescriptor: string,
): SystemError =>
  new SystemError({
    reason,
    module: "FileSystem",
    method,
    pathOrDescriptor,
  });

const toEncodedSecret = (value: string): string => Buffer.from(`enc:${value}`).toString("base64");

const assertUnavailableAcrossAllOperations = async (store: SecretStore): Promise<void> => {
  const hasSecretExit = await Effect.runPromiseExit(store.hasSecret("openai-api-key"));
  expect(extractFailure(hasSecretExit)).toBeInstanceOf(SecretStoreUnavailable);

  const getSecretExit = await Effect.runPromiseExit(store.getSecret("openai-api-key"));
  expect(extractFailure(getSecretExit)).toBeInstanceOf(SecretStoreUnavailable);

  const setSecretExit = await Effect.runPromiseExit(store.setSecret("openai-api-key", "secret"));
  expect(extractFailure(setSecretExit)).toBeInstanceOf(SecretStoreUnavailable);

  const deleteSecretExit = await Effect.runPromiseExit(store.deleteSecret("openai-api-key"));
  expect(extractFailure(deleteSecretExit)).toBeInstanceOf(SecretStoreUnavailable);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("secret store", () => {
  it("returns hasSecret=false and SecretNotFound when file is missing", async () => {
    await withTempSecretsDir(async ({ encryptedFilePath }) => {
      const store = await makeStore(encryptedFilePath);

      const configured = await Effect.runPromise(store.hasSecret("openai-api-key"));
      expect(configured).toBe(false);

      const getSecretExit = await Effect.runPromiseExit(store.getSecret("openai-api-key"));
      const failure = extractFailure(getSecretExit);
      expect(failure).toBeInstanceOf(SecretNotFound);

      await expect(fs.access(encryptedFilePath)).rejects.toThrow();
    });
  });

  it("returns SecretStoreReadFailed for corrupted JSON", async () => {
    await withTempSecretsDir(async ({ encryptedFilePath }) => {
      await fs.writeFile(encryptedFilePath, "{ broken json", "utf8");
      const store = await makeStore(encryptedFilePath);

      const exit = await Effect.runPromiseExit(store.hasSecret("openai-api-key"));
      const failure = extractFailure(exit);
      expect(failure).toBeInstanceOf(SecretStoreReadFailed);
    });
  });

  it("returns SecretStoreReadFailed for invalid JSON shape", async () => {
    await withTempSecretsDir(async ({ encryptedFilePath }) => {
      await fs.writeFile(encryptedFilePath, JSON.stringify({ "openai-api-key": 42 }), "utf8");
      const store = await makeStore(encryptedFilePath);

      const exit = await Effect.runPromiseExit(store.hasSecret("openai-api-key"));
      const failure = extractFailure(exit);
      expect(failure).toBeInstanceOf(SecretStoreReadFailed);
    });
  });

  it("maps write path failures to SecretStoreWriteFailed", async () => {
    const encryptedFilePath = "/virtual/userData/secrets.json";

    const failingFileSystem = FileSystem.layerNoop({
      readFileString: () =>
        Effect.fail(makeSystemError("NotFound", "readFileString", encryptedFilePath)),
      makeDirectory: () => Effect.void,
      open: () => Effect.fail(makeSystemError("PermissionDenied", "open", encryptedFilePath)),
      remove: () => Effect.void,
    });

    const store = await makeSecretStore({ encryptedFilePath }).pipe(
      Effect.provide(failingFileSystem),
      Effect.runPromise,
    );

    const exit = await Effect.runPromiseExit(store.setSecret("openai-api-key", "secret"));
    const failure = extractFailure(exit);
    expect(failure).toBeInstanceOf(SecretStoreWriteFailed);
  });

  it("maps unavailable encryption to SecretStoreUnavailable across all operations", async () => {
    await withTempSecretsDir(async ({ encryptedFilePath }) => {
      vi.spyOn(safeStorage, "isEncryptionAvailable").mockReturnValue(false);

      const store = await makeStore(encryptedFilePath);
      await assertUnavailableAcrossAllOperations(store);
    });
  });

  it("maps insecure linux backends to SecretStoreUnavailable across all operations", async () => {
    await withTempSecretsDir(async ({ encryptedFilePath }) => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
      if (!originalDescriptor) {
        throw new Error("Unable to read process.platform descriptor.");
      }

      const backendSpy = vi.spyOn(safeStorage, "getSelectedStorageBackend");
      vi.spyOn(safeStorage, "isEncryptionAvailable").mockReturnValue(true);

      Object.defineProperty(process, "platform", {
        value: "linux",
        configurable: true,
      });

      try {
        const store = await makeStore(encryptedFilePath);

        for (const backend of ["basic_text", "unknown"] as const) {
          backendSpy.mockReturnValue(backend);
          await assertUnavailableAcrossAllOperations(store);
        }
      } finally {
        Object.defineProperty(process, "platform", originalDescriptor);
      }
    });
  });

  it("set/get round-trip encrypts at rest", async () => {
    await withTempSecretsDir(async ({ encryptedFilePath }) => {
      const store = await makeStore(encryptedFilePath);
      await Effect.runPromise(store.setSecret("openai-api-key", "top-secret"));

      const hasSecret = await Effect.runPromise(store.hasSecret("openai-api-key"));
      expect(hasSecret).toBe(true);

      const value = await Effect.runPromise(store.getSecret("openai-api-key"));
      expect(value).toBe("top-secret");

      const rawFile = await fs.readFile(encryptedFilePath, "utf8");
      expect(rawFile).toContain("openai-api-key");
      expect(rawFile).not.toContain("top-secret");
    });
  });

  it("preserves unknown keys when writing known keys", async () => {
    await withTempSecretsDir(async ({ encryptedFilePath }) => {
      const unknownKey = "gemini-api-key";
      const unknownValue = "opaque-forward-compat-payload";
      const existingOpenAiValue = toEncodedSecret("existing-openai");

      await fs.writeFile(
        encryptedFilePath,
        JSON.stringify({
          [unknownKey]: unknownValue,
          "openai-api-key": existingOpenAiValue,
        }),
        "utf8",
      );

      const store = await makeStore(encryptedFilePath);
      await Effect.runPromise(store.setSecret("anthropic-api-key", "new-anthropic"));

      const persisted = JSON.parse(await fs.readFile(encryptedFilePath, "utf8")) as Record<
        string,
        string
      >;
      expect(persisted[unknownKey]).toBe(unknownValue);
      expect(persisted["openai-api-key"]).toBe(existingOpenAiValue);
      expect(persisted["anthropic-api-key"]).toBe(toEncodedSecret("new-anthropic"));
    });
  });

  it("does not materialize secrets file when deleteSecret key is absent", async () => {
    await withTempSecretsDir(async ({ encryptedFilePath }) => {
      const store = await makeStore(encryptedFilePath);
      await Effect.runPromise(store.deleteSecret("openai-api-key"));
      await expect(fs.access(encryptedFilePath)).rejects.toThrow();
    });
  });

  it("does not rewrite existing file when deleteSecret key is absent", async () => {
    await withTempSecretsDir(async ({ encryptedFilePath }) => {
      const rawSecrets = `{"openai-api-key":"${toEncodedSecret("existing-openai")}","future-api-key":"opaque"}`;
      await fs.writeFile(encryptedFilePath, rawSecrets, "utf8");

      const store = await makeStore(encryptedFilePath);
      await Effect.runPromise(store.deleteSecret("anthropic-api-key"));

      const persistedRaw = await fs.readFile(encryptedFilePath, "utf8");
      expect(persistedRaw).toBe(rawSecrets);
    });
  });

  it("maps encryptString failures to SecretStoreUnavailable", async () => {
    await withTempSecretsDir(async ({ encryptedFilePath }) => {
      vi.spyOn(safeStorage, "encryptString").mockImplementation(() => {
        throw new Error("encrypt failed");
      });

      const store = await makeStore(encryptedFilePath);
      const exit = await Effect.runPromiseExit(store.setSecret("openai-api-key", "secret"));
      const failure = extractFailure(exit);
      expect(failure).toBeInstanceOf(SecretStoreUnavailable);
    });
  });

  it("maps decryptString failures to SecretDecryptionFailed", async () => {
    await withTempSecretsDir(async ({ encryptedFilePath }) => {
      vi.spyOn(safeStorage, "decryptString").mockImplementation(() => {
        throw new Error("decrypt failed");
      });

      const store = await makeStore(encryptedFilePath);
      await fs.writeFile(
        encryptedFilePath,
        JSON.stringify({ "openai-api-key": toEncodedSecret("value") }),
        "utf8",
      );

      const exit = await Effect.runPromiseExit(store.getSecret("openai-api-key"));
      const failure = extractFailure(exit);
      expect(failure).toBeInstanceOf(SecretDecryptionFailed);
    });
  });

  it("attempts temp file cleanup when write fails", async () => {
    const encryptedFilePath = "/virtual/userData/secrets.json";
    const cleanupSpy = vi.fn(() => Effect.void);

    const failingFileSystem = FileSystem.layerNoop({
      readFileString: () =>
        Effect.fail(makeSystemError("NotFound", "readFileString", encryptedFilePath)),
      makeDirectory: () => Effect.void,
      open: () => Effect.fail(makeSystemError("PermissionDenied", "open", encryptedFilePath)),
      remove: cleanupSpy,
    });

    const store = await makeSecretStore({ encryptedFilePath }).pipe(
      Effect.provide(failingFileSystem),
      Effect.runPromise,
    );

    const exit = await Effect.runPromiseExit(store.setSecret("openai-api-key", "secret"));
    const failure = extractFailure(exit);
    expect(failure).toBeInstanceOf(SecretStoreWriteFailed);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });
});
