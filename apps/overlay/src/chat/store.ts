import {
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { ChatBackend, ChatError, type ChatConnection } from "./backend";
import { chatLocked, initialChatState, receiveText, type ChatEvent, type ChatState } from "./model";

export interface ChatStore {
  readonly changes: Stream.Stream<ChatState>;
  readonly start: Effect.Effect<void>;
  readonly reconnect: Effect.Effect<void>;
  readonly newChat: Effect.Effect<void>;
  readonly selectSession: (id: string) => Effect.Effect<void>;
  readonly selectModel: (key: string) => Effect.Effect<void>;
  readonly setDraft: (text: string) => Effect.Effect<void>;
  readonly send: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void>;
}
export const ChatStore = Context.Service<ChatStore>("overlay/ChatStore");

export const ChatStoreLive = Layer.effect(
  ChatStore,
  Effect.gen(function* () {
    const backend = yield* ChatBackend;
    const scope = yield* Scope.fork(yield* Scope.Scope);
    const state = yield* SubscriptionRef.make(initialChatState);
    // Serialize server events with commands so a snapshot cannot overwrite a newer send.
    // This is state synchronization, not a queue of user messages.
    const commands = yield* Semaphore.make(1);
    // Lifecycle requests can interrupt the event worker without waiting for its command permit.
    const lifecycle = yield* Semaphore.make(1);
    let connection: ChatConnection | undefined;
    let worker: Fiber.Fiber<void> | undefined;
    let initialized = false;
    // Retain the ID after an uncertain HTTP result, so retry cannot add a second message.
    const recovery: {
      pendingSend?: { sessionID: string; messageID: string; text: string };
      pendingSession?: { sessionID: string; model: string; title: string };
    } = {};
    const update = (change: Partial<ChatState>) =>
      SubscriptionRef.update(state, (value) => ({ ...value, ...change }));
    const disconnected = (error: ChatError) =>
      update({
        connection: "disconnected",
        error: error.message,
        changing: false,
        stopping: false,
      });

    const forgetSession = Effect.fn("Chat.forgetSession")(function* (error: ChatError) {
      recovery.pendingSend = undefined;
      recovery.pendingSession = undefined;
      yield* SubscriptionRef.update(state, (value) => ({
        ...value,
        session: undefined,
        messages: [],
        running: false,
        changing: false,
        stopping: false,
        activity: undefined,
        outcome: undefined,
        error: error.message,
        sessions:
          error.kind === "missing"
            ? value.sessions.filter((item) => item.id !== value.session?.id)
            : value.sessions,
      }));
    });
    const commandFailed = (error: ChatError) => {
      switch (error.kind) {
        case "missing":
          return forgetSession(error);
        case "rejected":
          return update({ error: error.message, stopping: false });
        case "connection":
        case "response":
          return disconnected(error);
      }
    };

    const restore = Effect.fn("Chat.restore")(function* (
      client: ChatConnection,
      sessionID: string,
    ) {
      const snapshot = yield* client.snapshot(sessionID);
      const accepted =
        recovery.pendingSend?.sessionID === sessionID &&
        (snapshot.messages.some((message) => message.id === recovery.pendingSend?.messageID) ||
          snapshot.pendingIDs.includes(recovery.pendingSend.messageID));
      if (accepted) recovery.pendingSend = undefined;
      yield* SubscriptionRef.update(state, (value) => ({
        ...value,
        session: snapshot.session,
        sessions: [
          snapshot.session,
          ...value.sessions.filter((item) => item.id !== snapshot.session.id),
        ],
        model: snapshot.session.model ?? value.model,
        messages: snapshot.messages,
        running: snapshot.running,
        stopping: false,
        outcome: snapshot.outcome,
        activity: snapshot.running ? "Working…" : undefined,
        error:
          snapshot.outcome === "failed"
            ? ([...snapshot.messages].reverse().find((message) => message.error)?.error ??
              "The response failed. You can try again.")
            : undefined,
        draft: accepted ? "" : value.draft,
      }));
    });

    const receive = Effect.fn("Chat.receive")(function* (client: ChatConnection, event: ChatEvent) {
      if (event.type === "connected") {
        const catalog = yield* client.models;
        const sessions = yield* client.history;
        const current = yield* SubscriptionRef.get(state);
        const session =
          current.session ??
          sessions.find((entry) => entry.id === recovery.pendingSession?.sessionID) ??
          (!initialized ? sessions[0] : undefined);
        if (session?.id === recovery.pendingSession?.sessionID) recovery.pendingSession = undefined;
        initialized = true;
        yield* update({
          sessions,
          models: catalog.models,
          model: current.model ?? catalog.defaultModel,
        });
        // A stale or unreadable selection must not trap every subsequent reconnect.
        // Saved conversations remain in OpenCode; keep the draft and offer a fresh selection.
        if (session)
          yield* restore(client, session.id).pipe(Effect.catchTag("ChatError", forgetSession));
        yield* update({ connection: "ready", changing: false });
        return;
      }
      const current = yield* SubscriptionRef.get(state);
      if (current.session?.id !== event.sessionID) return;
      switch (event.type) {
        case "started":
          yield* update({
            running: true,
            outcome: undefined,
            error: undefined,
            activity: "Working…",
          });
          break;
        case "text":
          yield* SubscriptionRef.update(state, (value) => ({
            ...value,
            messages: receiveText(value.messages, event),
            activity: "Responding…",
          }));
          break;
        case "activity":
          yield* update({ activity: event.text });
          break;
        case "finished":
          // Text ending (or a single model step ending) does not mean the turn is over.
          yield* client.waitUntilIdle(event.sessionID);
          yield* restore(client, event.sessionID);
          yield* update({ connection: "ready", ...(event.error ? { error: event.error } : {}) });
          break;
      }
    });

    const watch = Effect.gen(function* () {
      const client = yield* backend.connect;
      connection = client;
      yield* client.events.pipe(
        Stream.runForEach((event) =>
          commands.withPermit(
            receive(client, event).pipe(
              Effect.catchTag("ChatError", (error) =>
                event.type === "connected"
                  ? disconnected(error)
                  : error.kind === "missing"
                    ? forgetSession(error)
                    : disconnected(error),
              ),
            ),
          ),
        ),
      );
      yield* Effect.fail(
        new ChatError({
          kind: "connection",
          message: "Connection closed. Reconnect to continue this chat.",
        }),
      );
    }).pipe(Effect.catchTag("ChatError", disconnected));

    const launch = Effect.gen(function* () {
      yield* update({ connection: "connecting", error: undefined });
      if (worker) yield* Fiber.interrupt(worker);
      yield* commands.withPermit(
        Effect.gen(function* () {
          connection = undefined;
          worker = yield* watch.pipe(Effect.forkIn(scope));
        }),
      );
    });
    const reconnect = lifecycle.withPermit(launch).pipe(Effect.withSpan("Chat.reconnect"));

    const command = (
      name: string,
      operation: (client: ChatConnection) => Effect.Effect<void, ChatError>,
    ) =>
      commands
        .withPermits(1)(
          Effect.gen(function* () {
            const current = yield* SubscriptionRef.get(state);
            if (!connection || chatLocked(current)) return;
            yield* update({ changing: true, error: undefined });
            yield* operation(connection).pipe(
              Effect.catchTag("ChatError", commandFailed),
              Effect.ensuring(update({ changing: false })),
            );
          }),
        )
        .pipe(Effect.withSpan(`Chat.${name}`));

    return {
      changes: SubscriptionRef.changes(state),
      start: lifecycle
        .withPermit(
          Effect.gen(function* () {
            if (!worker) yield* launch;
          }),
        )
        .pipe(Effect.withSpan("Chat.start")),
      shutdown: Scope.close(scope, Exit.void),
      reconnect,
      setDraft: (draft) =>
        SubscriptionRef.update(state, (value) => (chatLocked(value) ? value : { ...value, draft })),
      newChat: command("newChat", () =>
        Effect.gen(function* () {
          recovery.pendingSend = undefined;
          recovery.pendingSession = undefined;
          yield* update({
            session: undefined,
            messages: [],
            draft: "",
            outcome: undefined,
            error: undefined,
          });
        }),
      ),
      selectSession: (id) =>
        command("selectSession", (client) =>
          Effect.gen(function* () {
            const current = yield* SubscriptionRef.get(state);
            if (!current.sessions.some((session) => session.id === id)) return;
            yield* restore(client, id);
            recovery.pendingSend = undefined;
            recovery.pendingSession = undefined;
            yield* update({ draft: "" });
          }),
        ),
      selectModel: (model) =>
        command("selectModel", (client) =>
          Effect.gen(function* () {
            const current = yield* SubscriptionRef.get(state);
            if (!current.models.some((entry) => entry.key === model)) return;
            if (current.session) yield* client.selectModel(current.session.id, model);
            yield* update({ model });
          }),
        ),
      send: command("send", (client) =>
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(state);
          const text = current.draft.trim();
          if (!text || !current.model) return;
          let session = current.session;
          if (!session) {
            const request = recovery.pendingSession ?? {
              sessionID: `ses_${crypto.randomUUID()}`,
              model: current.model,
              title: text.slice(0, 80),
            };
            recovery.pendingSession = request;
            session = yield* client.create(request.sessionID, request.model, request.title);
            recovery.pendingSession = undefined;
          }
          if (
            !recovery.pendingSend ||
            recovery.pendingSend.sessionID !== session.id ||
            recovery.pendingSend.text !== text
          ) {
            recovery.pendingSend = {
              sessionID: session.id,
              messageID: `msg_${crypto.randomUUID()}`,
              text,
            };
          }
          const request = recovery.pendingSend;
          yield* SubscriptionRef.update(
            state,
            (value): ChatState => ({
              ...value,
              session,
              running: true,
              outcome: undefined,
              activity: "Sending…",
              sessions: [session, ...value.sessions.filter((item) => item.id !== session.id)],
              messages: value.messages.some((message) => message.id === request.messageID)
                ? value.messages
                : [
                    ...value.messages,
                    {
                      id: request.messageID,
                      role: "user",
                      parts: [{ ordinal: 0, text, complete: true }],
                    },
                  ],
            }),
          );
          yield* client.send(session.id, request.messageID, text).pipe(
            Effect.catchTag("ChatError", (error) =>
              Effect.gen(function* () {
                if (error.kind === "rejected" || error.kind === "missing") {
                  recovery.pendingSend = undefined;
                  yield* SubscriptionRef.update(state, (value) => ({
                    ...value,
                    running: false,
                    activity: undefined,
                    messages: value.messages.filter((message) => message.id !== request.messageID),
                  }));
                  // A conflict may mean another client is already running this session.
                  if (error.kind === "rejected") yield* restore(client, session.id);
                }
                return yield* error;
              }),
            ),
          );
          recovery.pendingSend = undefined;
          yield* update({ draft: "" });
        }),
      ),
      stop: commands.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(state);
          if (
            !connection ||
            current.connection !== "ready" ||
            !current.session ||
            !current.running ||
            current.stopping
          )
            return;
          yield* update({ stopping: true, activity: "Stopping…" });
          yield* connection
            .stop(current.session.id)
            .pipe(
              Effect.andThen(restore(connection, current.session.id)),
              Effect.catchTag("ChatError", commandFailed),
            );
        }),
      ),
    } satisfies ChatStore;
  }),
);
