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
import {
  chatLocked,
  initialChatState,
  receiveText,
  type ChatEvent,
  type ChatSession,
  type ChatState,
} from "./model";

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

interface PendingSend {
  readonly sessionID: string;
  readonly messageID: string;
  readonly text: string;
}
interface PendingSession {
  readonly sessionID: string;
  readonly model: string;
  readonly title: string;
}

const unexpected = new ChatError({
  kind: "response",
  message: "Chat stopped unexpectedly. Reconnect to continue.",
});

const lastError = (messages: ChatState["messages"]) =>
  [...messages].reverse().find((message) => message.error)?.error ??
  "The response failed. You can try again.";

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
    let settling: Fiber.Fiber<void> | undefined;
    let initialized = false;
    // Retain the ID after an uncertain HTTP result, so retry cannot add a second message.
    const recovery: { pendingSend?: PendingSend; pendingSession?: PendingSession } = {};

    const update = (change: Partial<ChatState>) =>
      SubscriptionRef.update(state, (value) => ({ ...value, ...change }));
    const disconnected = (error: ChatError) =>
      update({
        connection: "disconnected",
        error: error.message,
        changing: false,
        stopping: false,
      });

    // The server cannot serve this session. Drop what refers to it; a deleted one leaves history.
    const forgetSession = Effect.fn("Chat.forgetSession")(function* (
      sessionID: string | undefined,
      error: ChatError,
    ) {
      if (recovery.pendingSend?.sessionID === sessionID) recovery.pendingSend = undefined;
      if (recovery.pendingSession?.sessionID === sessionID) recovery.pendingSession = undefined;
      yield* SubscriptionRef.update(state, (value) => ({
        ...value,
        ...(value.session?.id === sessionID
          ? {
              session: undefined,
              messages: [],
              running: false,
              activity: undefined,
              outcome: undefined,
            }
          : {}),
        changing: false,
        stopping: false,
        error: error.message,
        sessions:
          error.kind === "missing"
            ? value.sessions.filter((item) => item.id !== sessionID)
            : value.sessions,
      }));
    });
    const commandFailed = (error: ChatError) => {
      switch (error.kind) {
        case "missing":
          return SubscriptionRef.get(state).pipe(
            Effect.flatMap((value) => forgetSession(value.session?.id, error)),
          );
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
      if (recovery.pendingSession?.sessionID === sessionID) recovery.pendingSession = undefined;
      const pending =
        recovery.pendingSend?.sessionID === sessionID ? recovery.pendingSend : undefined;
      const accepted =
        pending !== undefined &&
        (snapshot.messages.some((message) => message.id === pending.messageID) ||
          snapshot.pendingIDs.includes(pending.messageID));
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
        error: snapshot.outcome === "failed" ? lastError(snapshot.messages) : undefined,
        // A newer draft written after the uncertain send is the user's; keep it.
        draft: accepted && value.draft.trim() === pending.text ? "" : value.draft,
      }));
    });
    // Only a definite answer about the session justifies dropping it; a timeout is not one.
    const restoreOrForget = (client: ChatConnection, sessionID: string) =>
      restore(client, sessionID).pipe(
        Effect.as(true),
        Effect.catchIf(
          (error) => error.kind !== "connection",
          (error) => forgetSession(sessionID, error).pipe(Effect.as(false)),
        ),
      );

    const connected = Effect.fn("Chat.connected")(function* (client: ChatConnection) {
      const catalog = yield* client.models;
      const sessions = yield* client.history;
      const current = yield* SubscriptionRef.get(state);
      const pendingSession = sessions.find(
        (entry) => entry.id === recovery.pendingSession?.sessionID,
      );
      // History is authoritative: a creation it lacks never happened, so the next send may
      // use the current model and text.
      if (!pendingSession) recovery.pendingSession = undefined;
      const selected: ChatSession | undefined =
        current.session ?? pendingSession ?? (initialized ? undefined : sessions[0]);
      yield* update({
        sessions,
        models: catalog.models,
        model: current.model ?? catalog.defaultModel,
      });
      // A stale or unreadable selection must not trap every subsequent reconnect.
      // Saved conversations remain in OpenCode; keep the draft and offer a fresh selection.
      if (selected) yield* restoreOrForget(client, selected.id);
      initialized = true;
      yield* update({ connection: "ready", changing: false });
    });

    // Text ending (or a single model step ending) does not mean the turn is over. Waiting for
    // idle happens outside the command permit so the next execution's events and Stop still run.
    const settle = (client: ChatConnection, sessionID: string, failure: string | undefined) =>
      Effect.gen(function* () {
        if (settling) yield* Fiber.interrupt(settling);
        settling = yield* client.waitUntilIdle(sessionID).pipe(
          Effect.andThen(
            commands.withPermit(
              Effect.gen(function* () {
                const current = yield* SubscriptionRef.get(state);
                if (current.session?.id !== sessionID) return;
                yield* restore(client, sessionID);
                yield* update({ connection: "ready", ...(failure ? { error: failure } : {}) });
              }),
            ),
          ),
          Effect.catchTag("ChatError", (error) =>
            commands.withPermit(
              error.kind === "missing" ? forgetSession(sessionID, error) : disconnected(error),
            ),
          ),
          Effect.catchDefect(() => commands.withPermit(disconnected(unexpected))),
          Effect.forkChild,
        );
      });

    const receive = Effect.fn("Chat.receive")(function* (client: ChatConnection, event: ChatEvent) {
      if (event.type === "connected") return yield* connected(client);
      const current = yield* SubscriptionRef.get(state);
      if (current.session?.id !== event.sessionID) return;
      switch (event.type) {
        case "started":
          return yield* update({
            running: true,
            outcome: undefined,
            error: undefined,
            activity: "Working…",
          });
        case "text":
          return yield* SubscriptionRef.update(state, (value) => ({
            ...value,
            messages: receiveText(value.messages, event),
            activity: "Responding…",
          }));
        case "activity":
          return yield* update({ activity: event.text });
        case "finished":
          return yield* settle(client, event.sessionID, event.error);
      }
    });

    const watch = Effect.gen(function* () {
      const client = yield* backend.connect;
      connection = client;
      yield* client.events.pipe(
        Stream.runForEach((event) =>
          commands.withPermit(
            receive(client, event).pipe(Effect.catchTag("ChatError", disconnected)),
          ),
        ),
      );
      return yield* new ChatError({
        kind: "connection",
        message: "Connection closed. Reconnect to continue this chat.",
      });
    }).pipe(
      Effect.catchTag("ChatError", disconnected),
      // The worker must end in a state the UI can recover from, whatever stopped it.
      Effect.catchDefect(() => disconnected(unexpected)),
    );

    const launch = Effect.gen(function* () {
      yield* update({ connection: "connecting", error: undefined });
      if (worker) yield* Fiber.interrupt(worker);
      yield* commands.withPermit(
        Effect.gen(function* () {
          connection = undefined;
          settling = undefined;
          worker = yield* watch.pipe(Effect.forkIn(scope));
        }),
      );
    });

    const command = (
      name: string,
      operation: (client: ChatConnection) => Effect.Effect<void, ChatError>,
    ) =>
      commands
        .withPermit(
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

    const createSession = Effect.fn("Chat.createSession")(function* (
      client: ChatConnection,
      model: string,
      text: string,
    ) {
      const request = recovery.pendingSession ?? {
        sessionID: `ses_${crypto.randomUUID()}`,
        model,
        title: text.slice(0, 80),
      };
      recovery.pendingSession = request;
      const session = yield* client.create(request.sessionID, request.model, request.title).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            // Nothing was created, so a retry should reflect the current model and text.
            if (error.kind === "rejected") recovery.pendingSession = undefined;
          }),
        ),
      );
      recovery.pendingSession = undefined;
      return session;
    });

    const send = Effect.fn("Chat.send")(function* (client: ChatConnection) {
      const current = yield* SubscriptionRef.get(state);
      const text = current.draft.trim();
      if (!text || !current.model) return;
      const session = current.session ?? (yield* createSession(client, current.model, text));
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
        Effect.tapError((error) =>
          Effect.gen(function* () {
            if (error.kind !== "rejected" && error.kind !== "missing") return;
            recovery.pendingSend = undefined;
            yield* SubscriptionRef.update(state, (value) => ({
              ...value,
              running: false,
              activity: undefined,
              messages: value.messages.filter((message) => message.id !== request.messageID),
            }));
            // A conflict may mean another client is already running this session.
            if (error.kind === "rejected") yield* restore(client, session.id);
          }),
        ),
      );
      recovery.pendingSend = undefined;
      yield* update({ draft: "" });
    });

    return {
      changes: SubscriptionRef.changes(state),
      start: lifecycle
        .withPermit(
          Effect.gen(function* () {
            if (!worker) yield* launch;
          }),
        )
        .pipe(Effect.withSpan("Chat.start")),
      reconnect: lifecycle.withPermit(launch).pipe(Effect.withSpan("Chat.reconnect")),
      shutdown: Scope.close(scope, Exit.void),
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
            if (!(yield* restoreOrForget(client, id))) return;
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
      send: command("send", send),
      stop: commands
        .withPermit(
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
            yield* update({ stopping: true });
            yield* connection
              .stop(current.session.id)
              .pipe(
                Effect.andThen(restore(connection, current.session.id)),
                Effect.catchTag("ChatError", commandFailed),
              );
          }),
        )
        .pipe(Effect.withSpan("Chat.stop")),
    } satisfies ChatStore;
  }),
);
