import { type Cause, Effect, Schema } from "effect";
import type { OpenCodeClient } from "@opencode/client/effect";
import { ChatError } from "./backend";

type RequestError = Effect.Error<
  ReturnType<
    OpenCodeClient["session"]["prompt" | "export" | "list"] | OpenCodeClient["model"]["list"]
  >
>;

const unreachable = () =>
  new ChatError({
    kind: "connection",
    message: "Could not reach OpenCode. Reconnect to check the saved conversation.",
  });
const unreadable = () =>
  new ChatError({
    kind: "response",
    message:
      "OpenCode returned a response Chat cannot read. If OpenCode was updated, the Overlay's OpenCode client may need updating too.",
  });

const toChatError = <A, R>(
  effect: Effect.Effect<A, RequestError | Cause.TimeoutError, R>,
): Effect.Effect<A, ChatError, R> =>
  effect.pipe(
    Effect.catchTags({
      TimeoutError: () =>
        Effect.fail(
          new ChatError({
            kind: "connection",
            message:
              "OpenCode took too long to respond. Reconnect to check the saved conversation.",
          }),
        ),
      // The SDK wraps transport and decoding failures in ClientError at runtime, so the
      // HttpClientError and SchemaError branches only exist for its declared types. A
      // transport failure leaves the request's fate unknown; only decoding means the server
      // answered.
      ClientError: (error) =>
        Effect.fail(Schema.isSchemaError(error.cause) ? unreadable() : unreachable()),
      HttpClientError: () => Effect.fail(unreachable()),
      SchemaError: () => Effect.fail(unreadable()),
      SessionNotFoundError: (error) =>
        Effect.fail(new ChatError({ kind: "missing", message: error.message })),
      ConflictError: (error) =>
        Effect.fail(new ChatError({ kind: "rejected", message: error.message })),
      InvalidRequestError: (error) =>
        Effect.fail(new ChatError({ kind: "rejected", message: error.message })),
      InvalidCursorError: (error) =>
        Effect.fail(new ChatError({ kind: "rejected", message: error.message })),
      UnauthorizedError: (error) =>
        Effect.fail(new ChatError({ kind: "rejected", message: error.message })),
      UnknownError: (error) =>
        Effect.fail(new ChatError({ kind: "response", message: error.message })),
      ServiceUnavailableError: (error) =>
        Effect.fail(new ChatError({ kind: "connection", message: error.message })),
    }),
  );

export const openCodeRequest = <A, R>(effect: Effect.Effect<A, RequestError, R>) =>
  toChatError(Effect.timeout(effect, "30 seconds"));

/** For calls that last as long as a response does, such as waiting for a session to go idle. */
export const openCodeWait = <A, R>(effect: Effect.Effect<A, RequestError, R>) =>
  toChatError(effect);
