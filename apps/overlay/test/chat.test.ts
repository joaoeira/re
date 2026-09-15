import { expect, test } from "bun:test";
import { Clock, Deferred, Effect, Layer, ManagedRuntime, Option, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { makeChatBridge } from "../src/chat/bridge";
import { ChatBackend, ChatError, type ChatConnection } from "../src/chat/backend";
import { ChatStore, ChatStoreLive } from "../src/chat/store";
import { type ChatEvent, type ChatSnapshot, type ChatState } from "../src/chat/model";

async function harness(start = true) {
  const events = await Effect.runPromise(Queue.unbounded<ChatEvent>());
  const session = { id: "session", title: "A conversation", model: "provider/model" };
  let saved: ChatSnapshot = { session, messages: [], pendingIDs: [], running: false };
  const liveClock = await Effect.runPromise(Clock.Clock);
  let snapshotError: ChatError | undefined;
  let sendError: ChatError | undefined;
  let blockCompletion = false;
  const completionEntered = Deferred.makeUnsafe<void>();
  let failSend = false;
  let failCreate = false;
  let blockSend = false;
  const sendEntered = Deferred.makeUnsafe<void>();
  let connections = 0;
  let subscriptions = 0;
  let history = [session];
  const created: string[] = [];
  const sent: string[] = [];
  const client: ChatConnection = {
    models: Effect.succeed({
      models: [{ key: "provider/model", name: "Model", provider: "Provider" }],
      defaultModel: "provider/model",
    }),
    history: Effect.sync(() => history),
    events: Stream.unwrap(
      Effect.sync(() => {
        subscriptions++;
        return Stream.concat(
          Stream.succeed<ChatEvent>({ type: "connected" }),
          Stream.fromQueue(events),
        );
      }),
    ).pipe(
      Stream.ensuring(
        Effect.sync(() => {
          subscriptions--;
        }),
      ),
    ),
    snapshot: () =>
      Effect.suspend(() => (snapshotError ? Effect.fail(snapshotError) : Effect.succeed(saved))),
    waitUntilIdle: () =>
      Effect.gen(function* () {
        if (blockCompletion) {
          yield* Deferred.succeed(completionEntered, undefined);
          yield* Effect.never;
        }
      }),
    create: (id, model, title) =>
      Effect.gen(function* () {
        created.push(id);
        const value = { id, model, title };
        history = [value];
        saved = { session: value, messages: [], pendingIDs: [], running: false };
        if (failCreate)
          return yield* new ChatError({ kind: "connection", message: "Lost the create response" });
        return value;
      }),
    selectModel: () => Effect.void,
    send: (_sessionID, id, text) =>
      Effect.gen(function* () {
        sent.push(id);
        yield* Deferred.succeed(sendEntered, undefined);
        if (blockSend) yield* Effect.never;
        if (sendError) return yield* sendError;
        if (failSend)
          return yield* new ChatError({
            kind: "connection",
            message: "Lost the admission response",
          });
        saved = {
          ...saved,
          running: true,
          messages: [
            ...saved.messages,
            {
              id,
              role: "user",
              parts: [{ ordinal: 0, text, complete: true }],
            },
          ],
        };
      }),
    stop: () =>
      Effect.sync(() => {
        saved = { ...saved, running: false, outcome: "interrupted" };
      }),
  };
  const runtime = ManagedRuntime.make(
    Layer.merge(
      TestClock.layer(),
      ChatStoreLive.pipe(
        Layer.provide(
          Layer.succeed(ChatBackend, {
            connect: Effect.sync(() => {
              connections++;
              return client;
            }),
          }),
        ),
      ),
    ),
  );
  const chat = await runtime.runPromise(ChatStore);
  const run = <A>(effect: Effect.Effect<A>) => runtime.runPromise(effect);
  const wait = (predicate: (state: ChatState) => boolean) =>
    runtime.runPromise(
      chat.changes.pipe(
        Stream.filter(predicate),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
        Effect.timeout("2 seconds"),
        Effect.provideService(Clock.Clock, liveClock),
      ),
    );
  if (start) {
    await run(chat.start);
    await wait((state) => state.connection === "ready");
  }
  return {
    chat,
    run,
    wait,
    sent,
    created,
    bridge: makeChatBridge(runtime),
    connections: () => connections,
    close: () => runtime.dispose(),
    subscriptions: () => subscriptions,
    sendEntered: () => run(Deferred.await(sendEntered)),
    advance: () => runtime.runPromise(TestClock.adjust("100 millis")),
    failSnapshot: (error?: ChatError) => {
      snapshotError = error;
    },
    rejectSend: (error?: ChatError) => {
      sendError = error;
    },
    blockCompletion: () => {
      blockCompletion = true;
    },
    completionEntered: () => run(Deferred.await(completionEntered)),
    failSend: (value: boolean) => {
      failSend = value;
    },
    failCreate: () => {
      failCreate = true;
    },
    blockSend: () => {
      blockSend = true;
    },
    save: (value: Partial<ChatSnapshot>) => {
      saved = { ...saved, ...value };
    },
    emit: (event: ChatEvent) => Effect.runPromise(Queue.offer(events, event)),
  };
}

test("sending locks the composer until the whole execution finishes, including after text ends", async () => {
  const h = await harness();
  try {
    await h.run(h.chat.setDraft("Hello"));
    await Promise.all([h.run(h.chat.send), h.run(h.chat.send)]);
    expect(h.sent).toHaveLength(1);
    await h.run(h.chat.setDraft("Must not be accepted while working"));
    await h.emit({
      type: "text",
      sessionID: "session",
      messageID: "answer",
      ordinal: 0,
      text: "Hello",
      complete: false,
    });
    await h.emit({
      type: "text",
      sessionID: "session",
      messageID: "answer",
      ordinal: 0,
      text: "Hello there.",
      complete: true,
    });
    const working = await h.wait((state) =>
      state.messages.some((m) => m.parts.some((p) => p.text === "Hello there.")),
    );
    expect(working.running).toBe(true);
    expect(working.draft).toBe("");
    h.save({ running: false, outcome: "succeeded", messages: working.messages });
    await h.emit({ type: "finished", sessionID: "session" });
    await h.wait((state) => !state.running);
    await h.run(h.chat.setDraft("Next turn"));
    await h.run(h.chat.send);
    expect(h.sent).toHaveLength(2);
  } finally {
    await h.close();
  }
});

test("an uncertain send retains the draft and reuses its message ID after reconnect", async () => {
  const h = await harness();
  try {
    h.failSend(true);
    await h.run(h.chat.setDraft("Keep this message"));
    await h.run(h.chat.send);
    const disconnected = await h.wait((state) => state.connection === "disconnected");
    expect(disconnected.draft).toBe("Keep this message");
    h.failSend(false);
    await h.run(h.chat.reconnect);
    await h.wait((state) => state.connection === "ready");
    await h.run(h.chat.send);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toBe(h.sent[0]);
  } finally {
    await h.close();
  }
});

test("reconnect clears an accepted draft without submitting it again", async () => {
  const h = await harness();
  try {
    h.failSend(true);
    await h.run(h.chat.setDraft("Already accepted"));
    await h.run(h.chat.send);
    h.save({
      running: false,
      messages: [
        {
          id: h.sent[0]!,
          role: "user",
          parts: [{ ordinal: 0, text: "Already accepted", complete: true }],
        },
        {
          id: "answer",
          role: "assistant",
          parts: [{ ordinal: 0, text: "Saved answer", complete: true }],
        },
      ],
    });
    await h.run(h.chat.reconnect);
    const restored = await h.wait((state) => state.connection === "ready");
    expect(restored.draft).toBe("");
    await h.run(h.chat.send);
    expect(h.sent).toHaveLength(1);
  } finally {
    await h.close();
  }
});

test("buffered text deltas do not duplicate a completed answer restored from the server", async () => {
  const h = await harness();
  try {
    h.save({
      messages: [
        {
          id: "answer",
          role: "assistant",
          parts: [{ ordinal: 0, text: "Saved answer", complete: true }],
        },
      ],
    });
    await h.run(h.chat.reconnect);
    await h.wait((state) => state.connection === "ready");
    await h.emit({
      type: "text",
      sessionID: "session",
      messageID: "answer",
      ordinal: 0,
      text: "Saved answer",
      complete: false,
    });
    // This following event is a processing barrier, not a delay guessed from wall time.
    await h.emit({ type: "activity", sessionID: "session", text: "Still working" });
    const current = await h.wait((state) => state.activity === "Still working");
    expect(current.messages.find((message) => message.id === "answer")?.parts[0]?.text).toBe(
      "Saved answer",
    );
  } finally {
    await h.close();
  }
});

test("stop restores the saved interrupted response without marking it successful", async () => {
  const h = await harness();
  try {
    await h.run(h.chat.setDraft("A long response"));
    await h.run(h.chat.send);
    h.save({
      messages: [
        {
          id: "answer",
          role: "assistant",
          parts: [{ ordinal: 0, text: "The answer so far", complete: true }],
        },
      ],
    });
    await h.run(h.chat.stop);
    const stopped = await h.wait((state) => !state.running);
    expect(stopped.outcome).toBe("interrupted");
    expect(stopped.messages.find((message) => message.id === "answer")?.parts[0]?.text).toBe(
      "The answer so far",
    );
    await h.run(h.chat.setDraft("Continue"));
    await h.run(h.chat.send);
    expect(h.sent).toHaveLength(2);
  } finally {
    await h.close();
  }
});

test("a lost session creation response recovers the same chat before sending", async () => {
  const h = await harness();
  try {
    await h.run(h.chat.newChat);
    await h.run(h.chat.setDraft("First message"));
    h.failCreate();
    await h.run(h.chat.send);
    await h.run(h.chat.reconnect);
    const restored = await h.wait((state) => state.connection === "ready");
    expect(restored.session?.id).toBe(h.created[0]);
    expect(restored.draft).toBe("First message");
    await h.run(h.chat.send);
    expect(h.created).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
  } finally {
    await h.close();
  }
});

test("repeated starts share one live event subscription", async () => {
  const h = await harness(false);
  try {
    await Promise.all([h.run(h.chat.start), h.run(h.chat.start)]);
    await h.wait((state) => state.connection === "ready");
    // Reopening Chat after the first connection is ready must not restart it either.
    await h.run(h.chat.start);
    await h.wait((state) => state.connection === "ready");
    expect(h.connections()).toBe(1);
    expect(h.subscriptions()).toBe(1);
  } finally {
    await h.close();
  }
});

test("the app boundary cancels a blocked request and closes its event subscription before disposal", async () => {
  const h = await harness();
  try {
    h.blockSend();
    await h.bridge.actions.setDraft("Waiting on the server");
    const sending = h.bridge.actions.send();
    await h.sendEntered();
    await h.bridge.close();
    await sending;
    expect(h.subscriptions()).toBe(0);
  } finally {
    await h.close();
  }
}, 2000);

test("a burst of state updates reaches the UI promptly without replaying every intermediate state", async () => {
  const h = await harness();
  const received: string[] = [];
  try {
    h.bridge.observe((state) => {
      received.push(state.draft);
    });
    await h.advance();
    received.length = 0;
    await h.run(
      Effect.forEach(
        Array.from({ length: 100 }, (_, i) => i),
        (i) => h.chat.setDraft(String(i)),
        { discard: true },
      ),
    );
    // Allow a generous UI delivery window without tying the test to a 16 ms frame.
    await h.advance();
    expect(received.at(-1)).toBe("99");
    expect(received.length).toBeLessThan(100);
  } finally {
    await h.bridge.close();
    await h.close();
  }
});

test("a deleted selection does not trap reconnect or prevent a new conversation", async () => {
  const h = await harness();
  try {
    h.failSnapshot(new ChatError({ kind: "missing", message: "This chat was deleted" }));
    await h.run(h.chat.reconnect);
    const ready = await h.wait((state) => state.connection === "ready");
    expect(ready.session).toBeUndefined();
    expect(ready.error).toBe("This chat was deleted");
    h.failSnapshot();
    await h.run(h.chat.newChat);
    await h.run(h.chat.setDraft("Start again"));
    await h.run(h.chat.send);
    expect(h.created).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
  } finally {
    await h.close();
  }
});

test("a rejected prompt keeps its draft and permits correction without reconnecting", async () => {
  const h = await harness();
  try {
    h.rejectSend(new ChatError({ kind: "rejected", message: "Request rejected" }));
    await h.run(h.chat.setDraft("Please answer"));
    await h.run(h.chat.send);
    const rejected = await h.wait((state) => !!state.error);
    expect(rejected.connection).toBe("ready");
    expect(rejected.error).toBe("Request rejected");
    expect(rejected.draft).toBe("Please answer");
    expect(rejected.messages).toHaveLength(0);
    h.rejectSend();
    await h.run(h.chat.setDraft("Corrected request"));
    await h.run(h.chat.send);
    expect(h.sent).toHaveLength(2);
    expect(h.connections()).toBe(1);
  } finally {
    await h.close();
  }
});

test("a failed completion refresh leaves the event stream alive and a later completion recovers", async () => {
  const h = await harness();
  try {
    await h.run(h.chat.setDraft("Hello"));
    await h.run(h.chat.send);
    h.failSnapshot(new ChatError({ kind: "connection", message: "Refresh timed out" }));
    await h.emit({ type: "finished", sessionID: "session" });
    await h.wait((state) => state.error === "Refresh timed out");
    await h.emit({ type: "activity", sessionID: "session", text: "Still connected" });
    await h.wait((state) => state.activity === "Still connected");
    h.failSnapshot();
    h.save({ running: false, outcome: "failed" });
    await h.emit({ type: "finished", sessionID: "session", error: "Provider refused the request" });
    const recovered = await h.wait((state) => state.connection === "ready" && !state.running);
    expect(recovered.error).toBe("Provider refused the request");
    expect(h.subscriptions()).toBe(1);
    await h.run(h.chat.setDraft("Try another request"));
    await h.run(h.chat.send);
    expect(h.sent).toHaveLength(2);
  } finally {
    await h.close();
  }
});

test("reconnect interrupts a completion handler blocked on the server", async () => {
  const h = await harness();
  try {
    h.blockCompletion();
    await h.emit({ type: "finished", sessionID: "session" });
    await h.completionEntered();
    await h.run(h.chat.reconnect);
    await h.wait((state) => state.connection === "ready");
    expect(h.connections()).toBe(2);
    expect(h.subscriptions()).toBe(1);
  } finally {
    await h.close();
  }
}, 2000);

test("text deltas append within their part and completion replaces that part in ordinal order", async () => {
  const h = await harness();
  try {
    for (const part of [
      { ordinal: 2, text: "B", complete: false },
      { ordinal: 0, text: "A", complete: false },
      { ordinal: 2, text: "eta", complete: false },
      { ordinal: 0, text: "Alpha", complete: true },
    ])
      await h.emit({ type: "text", sessionID: "session", messageID: "answer", ...part });
    await h.emit({ type: "activity", sessionID: "session", text: "Parts received" });
    const current = await h.wait((state) => state.activity === "Parts received");
    expect(
      current.messages.find((message) => message.id === "answer")?.parts.map((part) => part.text),
    ).toEqual(["Alpha", "Beta"]);
  } finally {
    await h.close();
  }
});
