import { Effect, type ManagedRuntime, Schedule, Stream } from "effect";
import { ChatStore } from "./store";
import type { ChatState } from "./model";

type ChatRuntime = Pick<
  ManagedRuntime.ManagedRuntime<ChatStore, never>,
  "runPromise" | "runCallback"
>;

export interface ChatActions {
  readonly start: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly newChat: () => Promise<void>;
  readonly selectSession: (id: string) => Promise<void>;
  readonly selectModel: (key: string) => Promise<void>;
  readonly setDraft: (text: string) => Promise<void>;
  readonly send: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

export interface ChatBridge {
  readonly actions: ChatActions;
  readonly observe: (onChange: (state: ChatState) => void) => () => void;
  readonly close: () => Promise<void>;
}

/** Cancellable React boundary. Chat requests must not delay the card persistence drain. */
export function makeChatBridge(runtime: ChatRuntime): ChatBridge {
  const requests = new Map<Promise<void>, AbortController>();
  const observers = new Set<() => void>();
  let closed = false;

  function run(operation: (chat: ChatStore) => Effect.Effect<void>): Promise<void> {
    if (closed) return Promise.resolve();
    const controller = new AbortController();
    const result = runtime
      .runPromise(ChatStore.pipe(Effect.flatMap(operation)), { signal: controller.signal })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) throw error;
      });
    requests.set(result, controller);
    void result.then(
      () => requests.delete(result),
      () => requests.delete(result),
    );
    return result;
  }

  return {
    actions: {
      start: () => run((chat) => chat.start),
      reconnect: () => run((chat) => chat.reconnect),
      newChat: () => run((chat) => chat.newChat),
      selectSession: (id: string) => run((chat) => chat.selectSession(id)),
      selectModel: (key: string) => run((chat) => chat.selectModel(key)),
      setDraft: (text: string) => run((chat) => chat.setDraft(text)),
      send: () => run((chat) => chat.send),
      stop: () => run((chat) => chat.stop),
    },
    observe(onChange: (state: ChatState) => void): () => void {
      if (closed) return () => {};
      const interrupt = runtime.runCallback(
        Stream.unwrap(ChatStore.pipe(Effect.map((chat) => chat.changes))).pipe(
          // Each value is a complete snapshot: render the newest one at most once per frame.
          Stream.buffer({ capacity: 1, strategy: "sliding" }),
          Stream.schedule(Schedule.spaced("16 millis")),
          Stream.runForEach((state) => Effect.sync(() => onChange(state))),
        ),
      );
      const cancel = () => {
        interrupt();
        observers.delete(cancel);
      };
      observers.add(cancel);
      return cancel;
    },
    async close(): Promise<void> {
      closed = true;
      for (const cancel of observers) cancel();
      for (const controller of requests.values()) controller.abort();
      await runtime.runPromise(ChatStore.pipe(Effect.flatMap((chat) => chat.shutdown)));
      await Promise.allSettled(requests.keys());
    },
  };
}
