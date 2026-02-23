import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import type { SecretStore } from "@main/secrets/secret-store";
import { SecretNotFound, SecretStoreUnavailable, type SecretKey } from "@shared/secrets";

import { createHandlersWithOverrides } from "./helpers";

const createInMemorySecretStore = (): SecretStore => {
  const map = new Map<SecretKey, string>();

  return {
    getSecret: (key) => {
      const value = map.get(key);
      if (value === undefined) {
        return Effect.fail(new SecretNotFound({ key }));
      }
      return Effect.succeed(value);
    },
    setSecret: (key, value) =>
      Effect.sync(() => {
        map.set(key, value);
      }),
    deleteSecret: (key) =>
      Effect.sync(() => {
        map.delete(key);
      }),
    hasSecret: (key) => Effect.succeed(map.has(key)),
  };
};

describe("secret handlers", () => {
  it("checks, sets, and deletes API keys without exposing secret values", async () => {
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-secret-handlers-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");

    try {
      const handlers = await createHandlersWithOverrides(settingsFilePath, {
        secretStore: createInMemorySecretStore(),
      });

      const initial = await Effect.runPromise(handlers.HasApiKey({ key: "openai-api-key" }));
      expect(initial.configured).toBe(false);

      const setResult = await Effect.runPromise(
        handlers.SetApiKey({ key: "openai-api-key", value: "sk-test-value" }),
      );
      expect(setResult.success).toBe(true);

      const afterSet = await Effect.runPromise(handlers.HasApiKey({ key: "openai-api-key" }));
      expect(afterSet.configured).toBe(true);

      const deleteResult = await Effect.runPromise(
        handlers.DeleteApiKey({ key: "openai-api-key" }),
      );
      expect(deleteResult.success).toBe(true);

      const afterDelete = await Effect.runPromise(handlers.HasApiKey({ key: "openai-api-key" }));
      expect(afterDelete.configured).toBe(false);
    } finally {
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("propagates typed store errors through RPC", async () => {
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-secret-handlers-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");

    const failingStore: SecretStore = {
      getSecret: (key) => Effect.fail(new SecretNotFound({ key })),
      setSecret: () =>
        Effect.fail(new SecretStoreUnavailable({ message: "encryption unavailable" })),
      deleteSecret: () =>
        Effect.fail(new SecretStoreUnavailable({ message: "encryption unavailable" })),
      hasSecret: () =>
        Effect.fail(new SecretStoreUnavailable({ message: "encryption unavailable" })),
    };

    try {
      const handlers = await createHandlersWithOverrides(settingsFilePath, {
        secretStore: failingStore,
      });

      const exit = await Effect.runPromiseExit(handlers.HasApiKey({ key: "openai-api-key" }));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected HasApiKey to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(SecretStoreUnavailable);
      }
    } finally {
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });
});
