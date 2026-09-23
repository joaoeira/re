import { expect, test } from "bun:test";
import { Clock, Deferred, Effect, Layer, ManagedRuntime, Option, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { makeChatBridge } from "../src/chat/bridge";
import { ChatBackend, ChatError, type ChatConnection } from "../src/chat/backend";
import { ChatStore, ChatStoreLive } from "../src/chat/store";
import type { ChatEvent, ChatMessage, ChatSnapshot, ChatState } from "../src/chat/model";

type Operation = "history" | "snapshot" | "idle" | "create" | "send" | "stop";

const lost = (message = "Lost the response") => new ChatError({ kind: "connection", message });
const rejected = (message: string) => new ChatError({ kind: "rejected", message });
const missing = (message: string) => new ChatError({ kind: "missing", message });
const user = (id: string, text: string): ChatMessage => ({
  id,
  role: "user",
  parts: [{ ordinal: 0, text, complete: true }],
});
const answer = (id: string, text: string): ChatMessage => ({
  id,
  role: "assistant",
  parts: [{ ordinal: 0, text, complete: true }],
});

/**
 * An in-memory OpenCode behind the real store. Faults are one-shot: `applied` means the
 * server did the work before the response was lost. `hold` keeps the next call open until
 * the test releases it or the store cancels it, which `cancelled` records.
 */
async function harness({ start = true, sessions = ["session"] } = {}) {
  const events = await Effect.runPromise(Queue.unbounded<ChatEvent>());
  const liveClock = await Effect.runPromise(Clock.Clock);
  const saved = new Map<string, ChatSnapshot>(
    sessions.map((id) => [
      id,
      {
        session: { id, title: `Chat ${id}`, model: "provider/model" },
        messages: [],
        pendingIDs: [],
        running: false,
      },
    ]),
  );
  let history = sessions.map((id) => saved.get(id)!.session);
  const faults = new Map<Operation, { error?: ChatError; applied: boolean }>();
  const held = new Map<
    Operation,
    { entered: Deferred.Deferred<void>; released: Deferred.Deferred<void> }
  >();
  const created: { id: string; model: string; title: string }[] = [];
  const sent: { sessionID: string; id: string; text: string }[] = [];
  const cancelled: Operation[] = [];
  let stops = 0;
  let connections = 0;
  let subscriptions = 0;

  const save = (id: string, value: Partial<ChatSnapshot>) =>
    saved.set(id, { ...saved.get(id)!, ...value });
  // Runs the server's side of a call, honoring any fault or hold queued for it.
  const serve = <A>(operation: Operation, work: () => A) =>
    Effect.gen(function* () {
      const hold = held.get(operation);
      if (hold) {
        held.delete(operation);
        yield* Deferred.succeed(hold.entered, undefined);
        yield* Deferred.await(hold.released).pipe(
          Effect.onInterrupt(() => Effect.sync(() => void cancelled.push(operation))),
        );
      }
      const fault = faults.get(operation);
      faults.delete(operation);
      if (fault && !fault.error) return yield* Effect.die(new Error(`${operation} crashed`));
      if (fault && !fault.applied) return yield* fault.error!;
      const value = work();
      if (fault) return yield* fault.error!;
      return value;
    });

  const client: ChatConnection = {
    models: Effect.succeed({
      models: [
        { key: "provider/model", name: "Model", provider: "Provider" },
        { key: "provider/other", name: "Other", provider: "Provider" },
      ],
      defaultModel: "provider/model",
    }),
    history: serve("history", () => history),
    events: Stream.unwrap(
      Effect.sync(() => {
        subscriptions++;
        return Stream.concat(
          Stream.succeed<ChatEvent>({ type: "connected" }),
          Stream.fromQueue(events),
        );
      }),
    ).pipe(Stream.ensuring(Effect.sync(() => void subscriptions--))),
    snapshot: (id) =>
      Effect.suspend(() => {
        const value = saved.get(id);
        return value ? serve("snapshot", () => value) : Effect.fail(missing(`${id} was deleted`));
      }),
    waitUntilIdle: () => serve("idle", () => undefined),
    create: (id, model, title) =>
      Effect.suspend(() => {
        created.push({ id, model, title });
        return serve("create", () => {
          const session = { id, model, title };
          history = [session, ...history];
          saved.set(id, { session, messages: [], pendingIDs: [], running: false });
          return session;
        });
      }),
    selectModel: () => Effect.void,
    send: (sessionID, id, text) =>
      Effect.suspend(() => {
        sent.push({ sessionID, id, text });
        return serve("send", () => {
          const value = saved.get(sessionID)!;
          save(sessionID, { running: true, messages: [...value.messages, user(id, text)] });
        });
      }),
    stop: (id) =>
      Effect.suspend(() => {
        stops++;
        return serve("stop", () => save(id, { running: false, outcome: "interrupted" }));
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
  const emit = (event: ChatEvent) => Effect.runPromise(Queue.offer(events, event));
  if (start) {
    await run(chat.start);
    await wait((state) => state.connection === "ready");
  }
  return {
    chat,
    run,
    wait,
    emit,
    save,
    created,
    sent,
    cancelled,
    bridge: makeChatBridge(runtime),
    stops: () => stops,
    connections: () => connections,
    subscriptions: () => subscriptions,
    fail: (operation: Operation, error: ChatError, { applied = false } = {}) =>
      void faults.set(operation, { error, applied }),
    crash: (operation: Operation) => void faults.set(operation, { applied: false }),
    hold: (operation: Operation) => {
      const hold = { entered: Deferred.makeUnsafe<void>(), released: Deferred.makeUnsafe<void>() };
      held.set(operation, hold);
      return {
        entered: () => run(Deferred.await(hold.entered)),
        release: () => run(Deferred.succeed(hold.released, undefined)),
      };
    },
    /** Every event before this one has been applied once its activity text is visible. */
    barrier: async (text: string, sessionID = "session") => {
      await emit({ type: "activity", sessionID, text });
      return wait((state) => state.activity === text);
    },
    compose: async (text: string) => {
      await run(chat.setDraft(text));
      await run(chat.send);
    },
    advance: () => runtime.runPromise(TestClock.adjust("100 millis")),
    close: () => runtime.dispose(),
  };
}

test("sending locks the composer until the whole execution finishes, including after text ends", async () => {
  const h = await harness();
  try {
    await h.run(h.chat.setDraft("Hello"));
    await Promise.all([h.run(h.chat.send), h.run(h.chat.send)]);
    expect(h.sent).toHaveLength(1);
    await h.run(h.chat.setDraft("Must not be accepted while working"));
    for (const [text, complete] of [
      ["Hello", false],
      ["Hello there.", true],
    ] as const)
      await h.emit({
        type: "text",
        sessionID: "session",
        messageID: "answer",
        ordinal: 0,
        text,
        complete,
      });
    const working = await h.wait((state) =>
      state.messages.some((m) => m.parts.some((p) => p.text === "Hello there.")),
    );
    expect(working).toMatchObject({ running: true, draft: "" });
    h.save("session", { running: false, outcome: "succeeded", messages: working.messages });
    await h.emit({ type: "finished", sessionID: "session" });
    await h.wait((state) => !state.running);
    await h.compose("Next turn");
    expect(h.sent).toHaveLength(2);
  } finally {
    await h.close();
  }
});

test("an uncertain send retains the draft and reuses its message ID after reconnect", async () => {
  const h = await harness();
  try {
    h.fail("send", lost());
    await h.compose("Keep this message");
    const disconnected = await h.wait((state) => state.connection === "disconnected");
    expect(disconnected.draft).toBe("Keep this message");
    await h.run(h.chat.reconnect);
    await h.wait((state) => state.connection === "ready");
    await h.run(h.chat.send);
    expect(h.sent.map((request) => request.id)).toEqual([h.sent[0]!.id, h.sent[0]!.id]);
  } finally {
    await h.close();
  }
});

test("reconnect clears an accepted draft without submitting it again", async () => {
  const h = await harness();
  try {
    h.fail("send", lost(), { applied: true });
    await h.compose("Already accepted");
    await h.wait((state) => state.connection === "disconnected");
    await h.run(h.chat.reconnect);
    const restored = await h.wait((state) => state.connection === "ready");
    expect(restored.draft).toBe("");
    await h.run(h.chat.send);
    expect(h.sent).toHaveLength(1);
  } finally {
    await h.close();
  }
});

test("a timeout while reopening the chat keeps it, so an accepted message is not sent twice", async () => {
  const h = await harness();
  try {
    h.fail("send", lost(), { applied: true });
    await h.compose("Already accepted");
    await h.wait((state) => state.connection === "disconnected");
    h.fail("snapshot", lost("OpenCode took too long to respond."));
    await h.run(h.chat.reconnect);
    const timedOut = await h.wait((state) => state.connection === "disconnected");
    expect(timedOut.session?.id).toBe("session");
    await h.run(h.chat.send);
    await h.run(h.chat.reconnect);
    const restored = await h.wait((state) => state.connection === "ready");
    expect(restored.draft).toBe("");
    expect(h.sent).toHaveLength(1);
    expect(h.created).toHaveLength(0);
  } finally {
    await h.close();
  }
});

test("a late confirmation of an earlier send keeps the newer draft written since", async () => {
  const h = await harness();
  try {
    h.fail("send", lost());
    await h.compose("Original");
    await h.wait((state) => state.connection === "disconnected");
    await h.run(h.chat.reconnect);
    await h.wait((state) => state.connection === "ready");
    await h.run(h.chat.setDraft("Something else entirely"));
    // The first request reaches the server after all and runs to completion.
    h.save("session", { messages: [user(h.sent[0]!.id, "Original"), answer("reply", "Done")] });
    await h.emit({ type: "finished", sessionID: "session" });
    const settled = await h.wait((state) => state.messages.some((m) => m.id === "reply"));
    expect(settled.draft).toBe("Something else entirely");
  } finally {
    await h.close();
  }
});

test("buffered text deltas do not duplicate a completed answer restored from the server", async () => {
  const h = await harness();
  try {
    h.save("session", { messages: [answer("answer", "Saved answer")] });
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
    const current = await h.barrier("Still working");
    expect(current.messages.find((m) => m.id === "answer")?.parts[0]?.text).toBe("Saved answer");
  } finally {
    await h.close();
  }
});

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
    const current = await h.barrier("Parts received");
    expect(current.messages.find((m) => m.id === "answer")?.parts.map((part) => part.text)).toEqual(
      ["Alpha", "Beta"],
    );
  } finally {
    await h.close();
  }
});

test("events for another conversation do not change the open one", async () => {
  const h = await harness({ sessions: ["session", "other"] });
  try {
    await h.compose("Hello");
    await h.emit({
      type: "text",
      sessionID: "other",
      messageID: "elsewhere",
      ordinal: 0,
      text: "Not for this chat",
      complete: true,
    });
    await h.emit({ type: "finished", sessionID: "other" });
    const current = await h.barrier("Still here");
    expect(current.messages.map((m) => m.id)).not.toContain("elsewhere");
    expect(current.running).toBe(true);
  } finally {
    await h.close();
  }
});

test("stop restores the saved interrupted response without marking it successful", async () => {
  const h = await harness();
  try {
    await h.compose("A long response");
    h.save("session", { messages: [answer("answer", "The answer so far")] });
    await h.run(h.chat.stop);
    const stopped = await h.wait((state) => !state.running);
    expect(stopped.outcome).toBe("interrupted");
    expect(stopped.messages.find((m) => m.id === "answer")?.parts[0]?.text).toBe(
      "The answer so far",
    );
    await h.compose("Continue");
    expect(h.sent).toHaveLength(2);
  } finally {
    await h.close();
  }
});

test("a rejected Stop leaves the response running and says why", async () => {
  const h = await harness();
  try {
    await h.compose("A long response");
    h.fail("stop", rejected("Cannot interrupt right now"));
    await h.run(h.chat.stop);
    const current = await h.wait((state) => !!state.error);
    expect(current).toMatchObject({
      running: true,
      stopping: false,
      error: "Cannot interrupt right now",
    });
    expect(current.activity).not.toBe("Stopping…");
    await h.run(h.chat.stop);
    expect(h.stops()).toBe(2);
  } finally {
    await h.close();
  }
});

test("a completion still waiting for idle does not hold back the next response or Stop", async () => {
  const h = await harness();
  try {
    await h.compose("Hello");
    const idle = h.hold("idle");
    await h.emit({ type: "finished", sessionID: "session" });
    await idle.entered();
    await h.emit({
      type: "text",
      sessionID: "session",
      messageID: "answer",
      ordinal: 0,
      text: "Still streaming",
      complete: false,
    });
    await h.wait((state) => state.messages.some((m) => m.id === "answer"));
    await h.run(h.chat.stop);
    expect(h.stops()).toBe(1);
    await h.wait((state) => !state.running);
  } finally {
    await h.close();
  }
}, 2000);

test("a completion that settles after the user opened another chat does not reopen the old one", async () => {
  const h = await harness({ sessions: ["session", "other"] });
  try {
    await h.compose("Hello");
    const idle = h.hold("idle");
    await h.emit({ type: "finished", sessionID: "session" });
    await idle.entered();
    await h.run(h.chat.stop);
    await h.wait((state) => !state.running);
    await h.run(h.chat.selectSession("other"));
    await idle.release();
    const current = await h.barrier("Opened", "other");
    expect(current.session?.id).toBe("other");
  } finally {
    await h.close();
  }
});

test("a lost session creation response recovers the same chat before sending", async () => {
  const h = await harness();
  try {
    await h.run(h.chat.newChat);
    h.fail("create", lost(), { applied: true });
    await h.compose("First message");
    await h.run(h.chat.reconnect);
    const restored = await h.wait((state) => state.connection === "ready");
    expect(restored.session?.id).toBe(h.created[0]!.id);
    expect(restored.draft).toBe("First message");
    await h.run(h.chat.send);
    expect(h.created).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
  } finally {
    await h.close();
  }
});

test("a chat creation that never reached OpenCode is retried with the current model and text", async () => {
  const h = await harness();
  try {
    await h.run(h.chat.newChat);
    h.fail("create", lost());
    await h.compose("First attempt");
    await h.wait((state) => state.connection === "disconnected");
    await h.run(h.chat.reconnect);
    await h.wait((state) => state.connection === "ready");
    await h.run(h.chat.selectModel("provider/other"));
    await h.compose("Second attempt");
    expect(h.created.at(-1)).toMatchObject({ model: "provider/other", title: "Second attempt" });
    expect(h.sent).toHaveLength(1);
  } finally {
    await h.close();
  }
});

test("a rejected chat creation is retried with the current model and text", async () => {
  const h = await harness();
  try {
    await h.run(h.chat.newChat);
    h.fail("create", rejected("Model is not available"));
    await h.compose("First attempt");
    const failed = await h.wait((state) => !!state.error);
    expect(failed).toMatchObject({ connection: "ready", draft: "First attempt" });
    await h.run(h.chat.selectModel("provider/other"));
    await h.compose("Second attempt");
    expect(h.created.at(-1)).toMatchObject({ model: "provider/other", title: "Second attempt" });
    expect(h.sent).toHaveLength(1);
  } finally {
    await h.close();
  }
});

test("a rejected prompt keeps its draft and permits correction without reconnecting", async () => {
  const h = await harness();
  try {
    h.fail("send", rejected("Request rejected"));
    await h.compose("Please answer");
    const failed = await h.wait((state) => !!state.error);
    expect(failed).toMatchObject({
      connection: "ready",
      error: "Request rejected",
      draft: "Please answer",
      messages: [],
    });
    await h.compose("Corrected request");
    expect(h.sent).toHaveLength(2);
    expect(h.connections()).toBe(1);
  } finally {
    await h.close();
  }
});

test("chats and models cannot change while a response is running", async () => {
  const h = await harness({ sessions: ["session", "other"] });
  try {
    await h.compose("Hello");
    await h.run(h.chat.selectSession("other"));
    await h.run(h.chat.selectModel("provider/other"));
    await h.run(h.chat.newChat);
    const current = await h.barrier("Still answering");
    expect(current.session?.id).toBe("session");
    expect(current.model).toBe("provider/model");
    expect(current.messages).toHaveLength(1);
  } finally {
    await h.close();
  }
});

test("a deleted selection does not trap reconnect or prevent a new conversation", async () => {
  const h = await harness();
  try {
    h.fail("snapshot", missing("This chat was deleted"));
    await h.run(h.chat.reconnect);
    const ready = await h.wait((state) => state.connection === "ready");
    expect(ready.session).toBeUndefined();
    expect(ready.error).toBe("This chat was deleted");
    await h.run(h.chat.newChat);
    await h.compose("Start again");
    expect(h.created).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
  } finally {
    await h.close();
  }
});

test("choosing a deleted chat from history removes that chat and keeps the open one", async () => {
  const h = await harness({ sessions: ["open", "deleted"] });
  try {
    h.fail("snapshot", missing("That chat was deleted"));
    await h.run(h.chat.selectSession("deleted"));
    const current = await h.wait((state) => !!state.error);
    expect(current.session?.id).toBe("open");
    expect(current.sessions.map((session) => session.id)).toEqual(["open"]);
  } finally {
    await h.close();
  }
});

test("a failed completion refresh leaves the event stream alive and a later completion recovers", async () => {
  const h = await harness();
  try {
    await h.compose("Hello");
    h.fail("snapshot", lost("Refresh timed out"));
    await h.emit({ type: "finished", sessionID: "session" });
    await h.wait((state) => state.error === "Refresh timed out");
    await h.barrier("Still connected");
    h.save("session", { running: false, outcome: "failed" });
    await h.emit({ type: "finished", sessionID: "session", error: "Provider refused the request" });
    const recovered = await h.wait((state) => state.connection === "ready" && !state.running);
    expect(recovered.error).toBe("Provider refused the request");
    expect(h.subscriptions()).toBe(1);
    await h.compose("Try another request");
    expect(h.sent).toHaveLength(2);
  } finally {
    await h.close();
  }
});

test("an unexpected adapter failure ends in a disconnected state that reconnect recovers", async () => {
  const h = await harness();
  try {
    await h.compose("Hello");
    h.crash("snapshot");
    await h.emit({ type: "finished", sessionID: "session" });
    await h.wait((state) => state.connection === "disconnected");
    h.crash("history");
    await h.run(h.chat.reconnect);
    await h.wait((state) => state.connection === "disconnected");
    await h.run(h.chat.reconnect);
    await h.wait((state) => state.connection === "ready");
  } finally {
    await h.close();
  }
});

test("reconnect cancels a completion still waiting on the old connection", async () => {
  const h = await harness();
  try {
    const idle = h.hold("idle");
    await h.emit({ type: "finished", sessionID: "session" });
    await idle.entered();
    await h.run(h.chat.reconnect);
    await h.wait((state) => state.connection === "ready");
    expect(h.cancelled).toEqual(["idle"]);
    expect(h.connections()).toBe(2);
    expect(h.subscriptions()).toBe(1);
  } finally {
    await h.close();
  }
}, 2000);

test("reconnect recovers while the previous connection is stuck loading its history", async () => {
  const h = await harness();
  try {
    const history = h.hold("history");
    await h.run(h.chat.reconnect);
    await history.entered();
    await h.run(h.chat.reconnect);
    await h.wait((state) => state.connection === "ready");
    expect(h.cancelled).toEqual(["history"]);
    expect(h.subscriptions()).toBe(1);
  } finally {
    await h.close();
  }
}, 2000);

test("repeated starts share one live event subscription", async () => {
  const h = await harness({ start: false });
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
    const sending = h.hold("send");
    await h.bridge.actions.setDraft("Waiting on the server");
    const request = h.bridge.actions.send();
    await sending.entered();
    await h.bridge.close();
    await request;
    expect(h.cancelled).toEqual(["send"]);
    expect(h.subscriptions()).toBe(0);
  } finally {
    await h.close();
  }
}, 2000);

test("the UI is handed the newest state, not one held back for a frame", async () => {
  const h = await harness();
  let latest = "";
  const stale: string[] = [];
  try {
    h.bridge.observe((state) => {
      if (state.draft !== latest) stale.push(state.draft);
    });
    await h.advance();
    for (const text of ["a", "ab", "abc", "abcd"]) {
      latest = text;
      await h.run(h.chat.setDraft(text));
      await Bun.sleep(1);
    }
    await h.advance();
    await h.advance();
    expect(stale).toEqual([]);
  } finally {
    await h.bridge.close();
    await h.close();
  }
});

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
