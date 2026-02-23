import { Effect, Stream } from "effect";
import type { StreamImplementations } from "electron-effect-rpc/types";

import { AiClientService } from "@main/di";
import type { AppContract } from "@shared/rpc/contracts";

type AiStreamHandlerKeys = "StreamCompletion";

export const createAiStreamHandlers = () =>
  Effect.gen(function* () {
    const aiClient = yield* AiClientService;

    const streamHandlers: Pick<StreamImplementations<AppContract, never>, AiStreamHandlerKeys> = {
      StreamCompletion: ({ model, prompt, systemPrompt }) =>
        aiClient
          .streamCompletion({ model, prompt, systemPrompt })
          .pipe(Stream.map((delta) => ({ delta }))),
    };

    return streamHandlers;
  });
