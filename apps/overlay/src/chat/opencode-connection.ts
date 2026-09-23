import { Effect } from "effect";
import type { HttpClient } from "effect/unstable/http";
import {
  AbsolutePath,
  Model,
  Session,
  SessionMessage,
  type OpenCodeClient,
} from "@opencode/client/effect";
import type { SessionListInput } from "@opencode/client/effect/api";
import type { ChatConnection } from "./backend";
import type { ChatMessage, ChatSession } from "./model";
import { chatAgent, chatDirectory, chatPermissions } from "./opencode-directory";
import { openCodeEvents } from "./opencode-events";
import { openCodeRequest, openCodeWait } from "./opencode-request";

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
      // Live events number text parts separately from reasoning and tool parts.
      parts: message.content
        .filter((part) => part.type === "text")
        .map((part, ordinal) => ({ ordinal, text: part.text, complete: true })),
    },
  ];
}

export function makeOpenCodeConnection(
  client: OpenCodeClient,
  http: HttpClient.HttpClient,
  baseUrl: string,
): ChatConnection {
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
    events: openCodeEvents(http, baseUrl),
    waitUntilIdle: (id) => openCodeWait(client.session.wait({ sessionID: Session.ID.make(id) })),
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
          // Cancelling an item that was already promoted is a no-op; interrupt handles it.
          for (const item of inbox)
            yield* client.session.inbox.cancel({ sessionID, inboxID: item.id });
          yield* client.session.interrupt({ sessionID });
          yield* client.session.wait({ sessionID });
        }),
      ),
  };
}
