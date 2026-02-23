import path from "node:path";

import { FileSystem } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Schema } from "@effect/schema";
import { Effect } from "effect";
import { safeStorage } from "electron";

import {
  SecretDecryptionFailed,
  SecretNotFound,
  SecretStoreReadFailed,
  SecretStoreUnavailable,
  SecretStoreWriteFailed,
  type SecretKey,
} from "@shared/secrets";

import type { SecretStore } from "./secret-store";

export interface MakeSecretStoreOptions {
  readonly encryptedFilePath: string;
}

type SecretMap = Record<string, string>;

const SecretMapSchema = Schema.Record({ key: Schema.String, value: Schema.String });

const decodeSecretMap = Schema.decodeUnknown(SecretMapSchema);

const asMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const toReadFailed = (path: string, message: string): SecretStoreReadFailed =>
  new SecretStoreReadFailed({ path, message });

const toWriteFailed = (path: string, message: string): SecretStoreWriteFailed =>
  new SecretStoreWriteFailed({ path, message });

const parseSecretMap = (
  path: string,
  raw: string,
): Effect.Effect<SecretMap, SecretStoreReadFailed> =>
  Effect.try({
    try: () => JSON.parse(raw),
    catch: (error) => toReadFailed(path, `Invalid secrets JSON: ${asMessage(error)}`),
  }).pipe(
    Effect.flatMap((parsed) =>
      decodeSecretMap(parsed).pipe(
        Effect.mapError(() => toReadFailed(path, "Invalid secrets JSON shape")),
      ),
    ),
  );

export const makeSecretStore = ({
  encryptedFilePath,
}: MakeSecretStoreOptions): Effect.Effect<SecretStore, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const semaphore = yield* Effect.makeSemaphore(1);
    const encryptedFileDirectory = path.dirname(encryptedFilePath);

    const loadMap = (): Effect.Effect<SecretMap, SecretStoreReadFailed> =>
      fileSystem.readFileString(encryptedFilePath, "utf8").pipe(
        Effect.catchAll((error) => {
          if (error._tag === "SystemError" && error.reason === "NotFound") {
            return Effect.succeed("{}");
          }

          return Effect.fail(
            toReadFailed(encryptedFilePath, `Failed to read secrets file: ${error.message}`),
          );
        }),
        Effect.flatMap((raw) => parseSecretMap(encryptedFilePath, raw)),
      );

    const persistMap = (map: SecretMap): Effect.Effect<void, SecretStoreWriteFailed> =>
      Effect.gen(function* () {
        const serialized = JSON.stringify(map, null, 2);
        const tempPath = `${encryptedFilePath}.${Date.now()}.tmp`;

        const mapWriteError = (error: PlatformError): SecretStoreWriteFailed =>
          toWriteFailed(encryptedFilePath, `Failed to persist secrets: ${error.message}`);

        const writeAndCommit = Effect.gen(function* () {
          yield* fileSystem
            .makeDirectory(encryptedFileDirectory, { recursive: true })
            .pipe(Effect.mapError(mapWriteError));

          yield* Effect.scoped(
            Effect.gen(function* () {
              const file = yield* fileSystem
                .open(tempPath, { flag: "w", mode: 0o600 })
                .pipe(Effect.mapError(mapWriteError));

              const content = new TextEncoder().encode(serialized);
              yield* file.writeAll(content).pipe(Effect.mapError(mapWriteError));
              yield* file.sync.pipe(Effect.mapError(mapWriteError));
            }),
          );

          yield* fileSystem
            .rename(tempPath, encryptedFilePath)
            .pipe(Effect.mapError(mapWriteError));

          if (process.platform !== "win32") {
            yield* fileSystem
              .chmod(encryptedFilePath, 0o600)
              .pipe(Effect.catchAll(() => Effect.void));
          }
        });

        yield* writeAndCommit.pipe(
          Effect.catchAll((error) =>
            fileSystem.remove(tempPath, { force: true }).pipe(
              Effect.catchAll(() => Effect.void),
              Effect.zipRight(Effect.fail(error)),
            ),
          ),
        );
      });

    const assertStoreUsable = (): Effect.Effect<void, SecretStoreUnavailable> =>
      Effect.gen(function* () {
        if (!safeStorage.isEncryptionAvailable()) {
          return yield* new SecretStoreUnavailable({
            message: "OS encryption is not available. A keyring daemon is required on Linux.",
          });
        }

        if (process.platform === "linux") {
          const backend = safeStorage.getSelectedStorageBackend();
          if (backend === "basic_text" || backend === "unknown") {
            return yield* new SecretStoreUnavailable({
              message:
                "Encryption backend is not secure (basic_text/unknown). Install and unlock gnome-keyring or kwallet.",
            });
          }
        }
      });

    const encryptToBase64 = (value: string): Effect.Effect<string, SecretStoreUnavailable> =>
      Effect.try({
        try: () => safeStorage.encryptString(value).toString("base64"),
        catch: (error) =>
          new SecretStoreUnavailable({
            message: `Failed to encrypt secret: ${asMessage(error)}`,
          }),
      });

    const decryptFromBase64 = (
      key: SecretKey,
      encrypted: string,
    ): Effect.Effect<string, SecretDecryptionFailed> =>
      Effect.try({
        try: () => safeStorage.decryptString(Buffer.from(encrypted, "base64")),
        catch: (error) =>
          new SecretDecryptionFailed({
            key,
            message: asMessage(error),
          }),
      });

    const withLock = semaphore.withPermits(1);

    return {
      getSecret: (key) =>
        withLock(
          Effect.gen(function* () {
            yield* assertStoreUsable();
            const map = yield* loadMap();
            const encrypted = map[key];

            if (encrypted === undefined) {
              return yield* new SecretNotFound({ key });
            }

            return yield* decryptFromBase64(key, encrypted);
          }),
        ),

      setSecret: (key, value) =>
        withLock(
          Effect.gen(function* () {
            yield* assertStoreUsable();
            const map = yield* loadMap();
            const encrypted = yield* encryptToBase64(value);
            yield* persistMap({ ...map, [key]: encrypted });
          }),
        ),

      deleteSecret: (key) =>
        withLock(
          Effect.gen(function* () {
            yield* assertStoreUsable();
            const map = yield* loadMap();

            if (!Object.prototype.hasOwnProperty.call(map, key)) {
              return;
            }

            const { [key]: _, ...rest } = map;
            yield* persistMap(rest);
          }),
        ),

      hasSecret: (key) =>
        withLock(
          Effect.gen(function* () {
            yield* assertStoreUsable();
            const map = yield* loadMap();
            return Object.prototype.hasOwnProperty.call(map, key);
          }),
        ),
    };
  });
