import { expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";
import { OpenCode } from "@opencode/client/effect";
import { makeOpenCodeConnection } from "../src/chat/opencode-connection";
import { receiveText } from "../src/chat/model";

// Exercise the installed SDK's HTTP decoding as well as the app adapter. No live
// daemon, credentials, provider request, or partial OpenCodeClient cast is involved.
async function connection(respond: (path: string) => Response | "unreachable") {
  const http = HttpClient.make((request, url) =>
    Effect.suspend(() => {
      const response = respond(url.pathname);
      return response === "unreachable"
        ? Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request }),
            }),
          )
        : Effect.succeed(HttpClientResponse.fromWeb(request, response));
    }),
  );
  const baseUrl = "http://opencode.test";
  const sdk = await Effect.runPromise(
    OpenCode.make({ baseUrl }).pipe(Effect.provideService(HttpClient.HttpClient, http)),
  );
  return makeOpenCodeConnection(sdk, http, baseUrl);
}

const feed = (...events: readonly { readonly type: string; readonly data?: unknown }[]) =>
  new Response(
    events
      .map(
        (event, index) =>
          `data: ${JSON.stringify({ id: `evt_${index}`, created: index, ...event })}\n\n`,
      )
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );

const session = {
  id: "ses_test",
  projectID: "global",
  agent: "overlay-chat",
  title: "Conversation",
  model: { providerID: "provider", id: "model" },
  location: { directory: "/chat" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
};

test("SDK snapshots and live events address the same text part after reasoning", async () => {
  const client = await connection((path) => {
    if (path.endsWith("/export"))
      return Response.json({
        data: {
          info: session,
          messages: [
            {
              id: "msg_answer",
              type: "assistant",
              agent: "overlay-chat",
              model: session.model,
              time: { created: 1 },
              content: [
                { type: "reasoning", text: "Internal" },
                { type: "text", text: "Answer" },
              ],
            },
          ],
        },
      });
    if (path.endsWith("/inbox")) return Response.json({ data: [] });
    if (path.endsWith("/active")) return Response.json({ data: {} });
    if (path === "/api/event")
      return new Response(
        `data: ${JSON.stringify({
          id: "evt_delta",
          created: 2,
          type: "session.text.delta",
          data: {
            sessionID: session.id,
            assistantMessageID: "msg_answer",
            ordinal: 0,
            delta: "Answer",
          },
        })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    throw new Error(`Unexpected request: ${path}`);
  });
  const snapshot = await Effect.runPromise(client.snapshot(session.id));
  const events = await Effect.runPromise(client.events.pipe(Stream.take(1), Stream.runCollect));
  let messages = snapshot.messages;
  for (const event of events) if (event.type === "text") messages = receiveText(messages, event);
  expect(events[0]?.type).toBe("text");
  expect(messages[0]?.parts.map((part) => part.text)).toEqual(["Answer"]);
});

test("an SDK conflict retains the server's rejection instead of reporting a lost connection", async () => {
  const client = await connection(() =>
    Response.json({ _tag: "ConflictError", message: "Session is busy" }, { status: 409 }),
  );
  const error = await Effect.runPromise(
    client.send(session.id, "msg_prompt", "Hello").pipe(Effect.flip),
  );
  expect(error.kind).toBe("rejected");
  expect(error.message).toBe("Session is busy");
});

test("an unreadable SDK response is distinguished from a rejected request", async () => {
  const client = await connection(() => Response.json({ unexpected: true }));
  const error = await Effect.runPromise(client.snapshot(session.id).pipe(Effect.flip));
  expect(error.kind).toBe("response");
});

// The store only drops a conversation on a definite answer, so an unreachable server
// must not be mistaken for one. The SDK hides transport failures inside ClientError.
test("an unreachable server leaves the request uncertain rather than unreadable", async () => {
  const client = await connection(() => "unreachable");
  const error = await Effect.runPromise(client.snapshot(session.id).pipe(Effect.flip));
  expect(error.kind).toBe("connection");
});

// OpenCode adds event types in patch releases; the feed carries every session's events.
test("an event type Chat does not know is skipped instead of ending the feed", async () => {
  const client = await connection(() =>
    feed(
      { type: "session.metadata.updated", data: { sessionID: session.id, metadata: {} } },
      { type: "session.execution.started", data: { sessionID: session.id } },
    ),
  );
  const events = await Effect.runPromise(client.events.pipe(Stream.runCollect));
  expect(events).toEqual([{ type: "started", sessionID: session.id }]);
});

test("a known event whose fields changed fails the feed with an explicit reason", async () => {
  const client = await connection(() =>
    feed({ type: "session.text.delta", data: { sessionID: session.id, content: "Renamed" } }),
  );
  const error = await Effect.runPromise(client.events.pipe(Stream.runCollect, Effect.flip));
  expect(error).toMatchObject({ kind: "response" });
  expect(error.message).toContain("session.text.delta");
});

test("SDK execution failures retain the provider error for the chat", async () => {
  const client = await connection(
    () =>
      new Response(
        `data: ${JSON.stringify({
          id: "evt_failed",
          created: 2,
          type: "session.execution.failed",
          durable: { aggregateID: session.id, seq: 1, version: 1 },
          data: {
            sessionID: session.id,
            error: { type: "provider", message: "Model unavailable" },
          },
        })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const events = await Effect.runPromise(client.events.pipe(Stream.take(1), Stream.runCollect));
  expect(events[0]).toMatchObject({
    type: "finished",
    sessionID: session.id,
    error: "Model unavailable",
  });
});
