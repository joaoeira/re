import { Effect } from "effect";
import type { OpenCodeClient } from "@opencode/client/effect";
import { toErrorMessage } from "../error-message";
import { ChatError } from "./backend";

type RequestError = Effect.Error<
  ReturnType<
    OpenCodeClient["session"]["prompt" | "export" | "list"] | OpenCodeClient["model"]["list"]
  >
>;

export const openCodeRequest = <A, R>(
  effect: Effect.Effect<A, RequestError, R>,
): Effect.Effect<A, ChatError, R> =>
  effect.pipe(
    Effect.timeout("30 seconds"),
    Effect.catchTags({
      TimeoutError: () =>
        Effect.fail(
          new ChatError({
            kind: "connection",
            message:
              "OpenCode took too long to respond. Reconnect to check the saved conversation.",
          }),
        ),
      HttpClientError: (error) =>
        Effect.fail(
          new ChatError({
            kind: "connection",
            message: "Could not reach OpenCode. Reconnect to check the saved conversation.",
          }),
        ),
      ClientError: (error) =>
        Effect.fail(
          new ChatError({
            kind: "response",
            message: `OpenCode could not complete the request: ${toErrorMessage(error.cause)}. Reconnect to check whether it was accepted.`,
          }),
        ),
      SchemaError: () =>
        Effect.fail(
          new ChatError({
            kind: "response",
            message:
              "OpenCode returned an unreadable response. Check that the server and client versions are compatible.",
          }),
        ),
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
