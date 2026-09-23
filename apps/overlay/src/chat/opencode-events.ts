import { Effect, Schema, Stream } from "effect";
import { Sse } from "effect/unstable/encoding";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { ChatError } from "./backend";
import type { ChatEvent } from "./model";

// OpenCode adds event types in patch releases, and the SDK's typed stream fails on the first one
// it does not know. The feed carries every session's events, so reading it directly and decoding
// only the fields Chat uses keeps Chat working when OpenCode is updated ahead of the SDK.

const lost = () =>
  new ChatError({
    kind: "connection",
    message: "Lost the connection to OpenCode. Reconnect to recover the latest messages.",
  });
const unreadable = (type: string) =>
  new ChatError({
    kind: "response",
    message: `OpenCode sent a ${type} event Chat cannot read. If OpenCode was updated, the Overlay's OpenCode client may need updating too.`,
  });

const SessionRef = Schema.Struct({ sessionID: Schema.String });
const TextPart = Schema.Struct({
  sessionID: Schema.String,
  assistantMessageID: Schema.String,
  ordinal: Schema.Number,
});
const TextDelta = Schema.Struct({ ...TextPart.fields, delta: Schema.String });
const TextEnded = Schema.Struct({ ...TextPart.fields, text: Schema.String });
const Failed = Schema.Struct({
  sessionID: Schema.String,
  error: Schema.Struct({ message: Schema.String }),
});

const view =
  <S extends Schema.Top>(schema: S, toEvent: (data: S["Type"]) => ChatEvent) =>
  (data: unknown) =>
    Schema.decodeUnknownEffect(schema)(data).pipe(Effect.map(toEvent));

const finished = view(SessionRef, (data) => ({ type: "finished", sessionID: data.sessionID }));
const activity = (text: string) =>
  view(SessionRef, (data) => ({ type: "activity", sessionID: data.sessionID, text }));

const views: Record<string, (data: unknown) => Effect.Effect<ChatEvent, Schema.SchemaError>> = {
  "server.connected": () => Effect.succeed({ type: "connected" }),
  "session.execution.started": view(SessionRef, (data) => ({
    type: "started",
    sessionID: data.sessionID,
  })),
  "session.execution.succeeded": finished,
  "session.execution.interrupted": finished,
  "session.execution.failed": view(Failed, (data) => ({
    type: "finished",
    sessionID: data.sessionID,
    error: data.error.message,
  })),
  "session.text.delta": view(TextDelta, (data) => ({
    type: "text",
    sessionID: data.sessionID,
    messageID: data.assistantMessageID,
    ordinal: data.ordinal,
    text: data.delta,
    complete: false,
  })),
  "session.text.ended": view(TextEnded, (data) => ({
    type: "text",
    sessionID: data.sessionID,
    messageID: data.assistantMessageID,
    ordinal: data.ordinal,
    text: data.text,
    complete: true,
  })),
  "session.retry.scheduled": activity("OpenCode is retrying…"),
  "session.compaction.started": activity("Making room in the conversation…"),
};

const Envelope = Schema.fromJsonString(
  Schema.Struct({ type: Schema.String, data: Schema.optional(Schema.Unknown) }),
);
// The HTTP API layer reports a server-side stream failure as this reserved event.
const streamFailure = "effect/httpapi/stream/failure";

const toChatEvent = (event: Sse.Event) =>
  Effect.gen(function* () {
    if (event.event === streamFailure) return yield* lost();
    const envelope = yield* Schema.decodeUnknownEffect(Envelope)(event.data).pipe(
      Effect.mapError(() => unreadable("server")),
    );
    const decode = views[envelope.type];
    if (!decode) return undefined;
    return yield* decode(envelope.data).pipe(Effect.mapError(() => unreadable(envelope.type)));
  });

export const openCodeEvents = (
  http: HttpClient.HttpClient,
  baseUrl: string,
): Stream.Stream<ChatEvent, ChatError> =>
  Stream.unwrap(
    http.get(new URL("/api/event", baseUrl), { headers: { accept: "text/event-stream" } }).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.map((response) => response.stream),
    ),
  ).pipe(
    Stream.decodeText,
    Stream.pipeThroughChannel(Sse.decode()),
    Stream.catchTags({
      HttpClientError: () => Stream.fail(lost()),
      Retry: () => Stream.fail(lost()),
      SseError: () => Stream.fail(unreadable("oversized")),
    }),
    Stream.mapEffect(toChatEvent),
    Stream.filter((event): event is ChatEvent => event !== undefined),
  );
