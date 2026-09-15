import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, FileSystem, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { OpenCode } from "@opencode/client/effect";
import { Service } from "@opencode/client/effect/service";
import { chatDirectory, prepareChatDirectory } from "./opencode-directory";
import { ChatBackend, ChatError } from "./backend";
import { openCodeRequest } from "./opencode-request";
import { makeOpenCodeConnection } from "./opencode-connection";

export const OpenCodeChatLive = Layer.effect(
  ChatBackend,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const http = yield* HttpClient.HttpClient;
    return {
      connect: Effect.gen(function* () {
        yield* prepareChatDirectory().pipe(
          Effect.mapError(
            () =>
              new ChatError({
                kind: "connection",
                message: "Could not prepare the app's chat directory.",
              }),
          ),
        );
        const executable =
          Bun.which("opencode") ??
          [
            join(homedir(), ".bun", "bin", "opencode"),
            "/opt/homebrew/bin/opencode",
            "/usr/local/bin/opencode",
          ].find((path) => Bun.which(path));
        const endpoint = yield* Service.ensure({
          command: executable ? [executable] : undefined,
        }).pipe(
          Effect.mapError(
            () =>
              new ChatError({
                kind: "connection",
                message:
                  "Could not start OpenCode. Install OpenCode v2 or start its local service, then reconnect.",
              }),
          ),
        );
        const headers = Service.headers(endpoint);
        const authenticated = HttpClient.mapRequest(http, (req) =>
          headers ? HttpClientRequest.setHeaders(req, headers) : req,
        );
        const client = yield* OpenCode.make({ baseUrl: endpoint.url }).pipe(
          Effect.provideService(HttpClient.HttpClient, authenticated),
        );
        const location = { directory: chatDirectory };
        yield* openCodeRequest(client.plugin.awaitActivation({ location }));
        const plugins = yield* openCodeRequest(client.plugin.list({ location }));
        const chatPlugin = plugins.data.find((entry) => entry.id === "re.overlay.chat");
        if (chatPlugin?.state.status !== "active") {
          return yield* new ChatError({
            kind: "connection",
            message:
              "OpenCode did not load the Chat agent's configuration. Reconnect to try again.",
          });
        }
        return makeOpenCodeConnection(client);
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.timeout("30 seconds"),
        Effect.catchTag("TimeoutError", () =>
          Effect.fail(
            new ChatError({
              kind: "connection",
              message: "OpenCode took too long to start. Reconnect to try again.",
            }),
          ),
        ),
      ),
    } satisfies ChatBackend;
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
