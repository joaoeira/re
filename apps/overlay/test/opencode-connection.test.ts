import { expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { OpenCode } from "@opencode/client/effect";
import { makeOpenCodeConnection } from "../src/chat/opencode-connection";
import { receiveText } from "../src/chat/model";

// Exercise the installed SDK's HTTP decoding as well as the app adapter. No live
// daemon, credentials, provider request, or partial OpenCodeClient cast is involved.
async function connection(respond: (path: string) => Response) {
  const http = HttpClient.make((request, url) =>
    Effect.sync(() => HttpClientResponse.fromWeb(request, respond(url.pathname))),
  );
  const sdk = await Effect.runPromise(
    OpenCode.make({ baseUrl: "http://opencode.test" }).pipe(
      Effect.provideService(HttpClient.HttpClient, http),
    ),
  );
  return makeOpenCodeConnection(sdk);
}

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
            ordinal: 1,
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
