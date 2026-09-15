import { Effect, Stream } from "effect";
import {
  AbsolutePath,
  Model,
  Session,
  SessionMessage,
  type OpenCodeClient,
  type OpenCodeEvent,
} from "@opencode/client/effect";
import type { SessionListInput } from "@opencode/client/effect/api";
import { ChatError, type ChatConnection } from "./backend";
import type { ChatEvent, ChatMessage, ChatSession } from "./model";
import { chatAgent, chatDirectory, chatPermissions } from "./opencode-directory";
import { openCodeRequest } from "./opencode-request";
import { toErrorMessage } from "../error-message";

const modelKey = (model: Model.Ref) => `${model.providerID}/${model.id}`;
const sessionView = (info: Session.Info): ChatSession => ({
  id: info.id,
  title: info.title || "New chat",
  model: info.model ? modelKey(info.model) : undefined,
});

function messageView(message: SessionMessage.Info): ChatMessage[] {
  if (message.type === "user")
    return [
      {
        id: message.id,
        role: "user",
        parts: [{ ordinal: 0, text: message.text, complete: true }],
      },
    ];
  if (message.type !== "assistant") return [];
  return [
    {
      id: message.id,
      role: "assistant",
      error: message.error?.message,
      parts: message.content.flatMap((part, ordinal) =>
        part.type === "text" ? [{ ordinal, text: part.text, complete: true }] : [],
      ),
    },
  ];
}

function eventView(event: OpenCodeEvent): ChatEvent[] {
  switch (event.type) {
    case "server.connected":
      return [{ type: "connected" }];
    case "session.execution.started":
      return [{ type: "started", sessionID: event.data.sessionID }];
    case "session.execution.succeeded":
    case "session.execution.interrupted":
      return [{ type: "finished", sessionID: event.data.sessionID }];
    case "session.execution.failed":
      return [
        { type: "finished", sessionID: event.data.sessionID, error: event.data.error.message },
      ];
    case "session.text.delta":
      return [
        {
          type: "text",
          sessionID: event.data.sessionID,
          messageID: event.data.assistantMessageID,
          ordinal: event.data.ordinal,
          text: event.data.delta,
          complete: false,
        },
      ];
    case "session.text.ended":
      return [
        {
          type: "text",
          sessionID: event.data.sessionID,
          messageID: event.data.assistantMessageID,
          ordinal: event.data.ordinal,
          text: event.data.text,
          complete: true,
        },
      ];
    case "session.retry.scheduled":
      return [{ type: "activity", sessionID: event.data.sessionID, text: "OpenCode is retrying…" }];
    case "session.compaction.started":
      return [
        {
          type: "activity",
          sessionID: event.data.sessionID,
          text: "Making room in the conversation…",
        },
      ];
    default:
      return [];
  }
}

export function makeOpenCodeConnection(client: OpenCodeClient): ChatConnection {
  const directory = AbsolutePath.make(chatDirectory);
  const location = { directory };
  const history = openCodeRequest(
    Effect.gen(function* () {
      const sessions: ChatSession[] = [];
      let cursor: SessionListInput["cursor"];
      do {
        const page = yield* client.session.list({ directory, limit: 100, order: "desc", cursor });
        sessions.push(...page.data.filter((info) => info.agent === chatAgent).map(sessionView));
        cursor = page.cursor.next;
      } while (cursor);
      return sessions;
    }),
  );
  return {
    history,
    models: openCodeRequest(
      Effect.gen(function* () {
        const catalog = yield* client.model.list({ location });
        const preferred = yield* client.model.default({ location });
        const models = catalog.data
          .filter((model) => model.enabled)
          .map((model) => ({
            key: modelKey(model),
            name: model.name,
            provider: model.providerID,
          }))
          .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
        return { models, defaultModel: preferred.data ? modelKey(preferred.data) : models[0]?.key };
      }),
    ),
    events: client.event.subscribe().pipe(
      Stream.flatMap((event) => Stream.fromIterable(eventView(event))),
      Stream.catchTags({
        Retry: () =>
          Stream.fail(
            new ChatError({
              kind: "connection",
              message:
                "OpenCode requested a new event connection. Reconnect to recover the latest messages.",
            }),
          ),
        SseError: (error) =>
          Stream.fail(
            new ChatError({
              kind: "response",
              message: `OpenCode event stream failed: ${error.message}`,
            }),
          ),
        ClientError: (error) =>
          Stream.fail(
            new ChatError({
              kind: "connection",
              message: `OpenCode event stream stopped: ${toErrorMessage(error.cause)}. Reconnect to recover the latest messages.`,
            }),
          ),
        HttpClientError: () =>
          Stream.fail(
            new ChatError({
              kind: "connection",
              message: "Connection lost. Reconnect to recover the latest messages.",
            }),
          ),
        SchemaError: () =>
          Stream.fail(
            new ChatError({
              kind: "response",
              message:
                "OpenCode sent an unreadable event. Check server and client compatibility, then reconnect.",
            }),
          ),
        InvalidRequestError: (error) =>
          Stream.fail(new ChatError({ kind: "rejected", message: error.message })),
        UnauthorizedError: (error) =>
          Stream.fail(new ChatError({ kind: "rejected", message: error.message })),
      }),
    ),
    waitUntilIdle: (id) => openCodeRequest(client.session.wait({ sessionID: Session.ID.make(id) })),
    snapshot: (id) =>
      openCodeRequest(
        Effect.gen(function* () {
          const sessionID = Session.ID.make(id);
          const saved = yield* client.session.export({ sessionID });
          const inbox = yield* client.session.inbox.list({ sessionID });
          const active = yield* client.session.active();
          const messages = saved.messages.flatMap(messageView);
          for (const item of inbox) {
            if (item.type !== "user" || messages.some((message) => message.id === item.id))
              continue;
            messages.push({
              id: item.id,
              role: "user",
              parts: [{ ordinal: 0, text: item.payload.text, complete: true }],
            });
          }
          return {
            session: sessionView(saved.info),
            messages,
            running: !!active[sessionID] || inbox.length > 0,
            pendingIDs: inbox.map((entry) => entry.id),
            outcome: saved.info.outcome,
          };
        }),
      ),
    create: (id, model, title) =>
      openCodeRequest(
        client.session
          .create({
            id: Session.ID.make(id),
            agent: chatAgent,
            model: Model.Ref.parse(model),
            title,
            location,
            permissions: chatPermissions,
          })
          .pipe(Effect.map(sessionView)),
      ),
    selectModel: (id, model) =>
      openCodeRequest(
        client.session.switchModel({
          sessionID: Session.ID.make(id),
          model: Model.Ref.parse(model),
        }),
      ),
    send: (id, messageID, text) =>
      openCodeRequest(
        client.session
          .prompt({
            sessionID: Session.ID.make(id),
            id: SessionMessage.ID.make(messageID),
            text,
          })
          .pipe(Effect.asVoid),
      ),
    stop: (id) =>
      openCodeRequest(
        Effect.gen(function* () {
          const sessionID = Session.ID.make(id);
          // Admission can precede execution. Stop must also withdraw that pending input.
          const inbox = yield* client.session.inbox.list({ sessionID });
          for (const item of inbox)
            yield* client.session.inbox.cancel({ sessionID, inboxID: item.id }).pipe(
              // Promotion may win the race; interrupt handles the now-running input.
              Effect.catchTag("ConflictError", () => Effect.void),
            );
          yield* client.session.interrupt({ sessionID });
          yield* client.session.wait({ sessionID });
        }),
      ),
  };
}
