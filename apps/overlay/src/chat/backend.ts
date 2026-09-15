import { Context, Data, Effect, Stream } from "effect";
import type { ChatEvent, ChatModel, ChatSession, ChatSnapshot } from "./model";

export class ChatError extends Data.TaggedError("ChatError")<{
  readonly message: string;
  readonly kind: "connection" | "rejected" | "missing" | "response";
}> {}

/** The small server contract the chat needs; provider credentials stay in OpenCode. */
export interface ChatConnection {
  readonly models: Effect.Effect<
    { readonly models: readonly ChatModel[]; readonly defaultModel?: string },
    ChatError
  >;
  readonly history: Effect.Effect<readonly ChatSession[], ChatError>;
  readonly events: Stream.Stream<ChatEvent, ChatError>;
  readonly snapshot: (sessionID: string) => Effect.Effect<ChatSnapshot, ChatError>;
  readonly waitUntilIdle: (sessionID: string) => Effect.Effect<void, ChatError>;
  readonly create: (
    sessionID: string,
    model: string,
    title: string,
  ) => Effect.Effect<ChatSession, ChatError>;
  readonly selectModel: (sessionID: string, model: string) => Effect.Effect<void, ChatError>;
  readonly send: (
    sessionID: string,
    messageID: string,
    text: string,
  ) => Effect.Effect<void, ChatError>;
  readonly stop: (sessionID: string) => Effect.Effect<void, ChatError>;
}

export interface ChatBackend {
  readonly connect: Effect.Effect<ChatConnection, ChatError>;
}
export const ChatBackend = Context.Service<ChatBackend>("overlay/ChatBackend");
