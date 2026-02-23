import { Effect } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import { SecretStoreService } from "@main/di";
import type { AppContract } from "@shared/rpc/contracts";

type SecretHandlerKeys = Extract<keyof Implementations<AppContract, never>, `${string}ApiKey`>;

export const createSecretHandlers = () =>
  Effect.gen(function* () {
    const secretStore = yield* SecretStoreService;

    const handlers: Pick<Implementations<AppContract, never>, SecretHandlerKeys> = {
      HasApiKey: ({ key }) =>
        secretStore.hasSecret(key).pipe(Effect.map((configured) => ({ configured }))),
      SetApiKey: ({ key, value }) =>
        secretStore.setSecret(key, value).pipe(Effect.map(() => ({ success: true }))),
      DeleteApiKey: ({ key }) =>
        secretStore.deleteSecret(key).pipe(Effect.map(() => ({ success: true }))),
    };

    return handlers;
  });
