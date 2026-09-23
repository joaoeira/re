import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, FileSystem, Layer, Schedule } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { OpenCode, type OpenCodeClient } from "@opencode/client/effect";
import { Service } from "@opencode/client/effect/service";
import overlayPackage from "../../package.json";
import { chatDirectory, prepareChatDirectory } from "./opencode-directory";
import { ChatBackend, ChatError } from "./backend";
import { openCodeRequest } from "./opencode-request";
import { makeOpenCodeConnection } from "./opencode-connection";

// The adapter tolerates OpenCode releasing ahead of the SDK it was built with (see
// opencode-events.ts); a different major version is a different API.
const clientVersion = overlayPackage.dependencies["@opencode/client"];
const major = (version: string) => version.replace(/^\D*/, "").split(".")[0];

// Apps opened from Finder or Raycast do not inherit the shell's PATH.
const installLocations = [
  join(homedir(), ".bun", "bin", "opencode"),
  "/opt/homebrew/bin/opencode",
  "/usr/local/bin/opencode",
];
const findOpenCode = () =>
  Bun.which("opencode") ?? installLocations.find((path) => Bun.which(path));

const failure = (message: string) => new ChatError({ kind: "connection", message });

const checkVersion = Effect.fn("Chat.checkVersion")(function* (client: OpenCodeClient) {
  const server = yield* openCodeRequest(client.server.info());
  if (major(server.version) !== major(clientVersion))
    return yield* failure(
      `Chat supports OpenCode ${major(clientVersion)}.x, but ${server.version} is running. Install OpenCode ${major(clientVersion)}, then reconnect.`,
    );
});

const awaitChatPlugin = Effect.fn("Chat.awaitChatPlugin")(function* (client: OpenCodeClient) {
  const plugin = yield* openCodeRequest(
    client.plugin.list({ location: { directory: chatDirectory } }).pipe(
      Effect.map((plugins) => plugins.data.find((entry) => entry.id === "re.overlay.chat")),
      // A location activates in the background; its first plugin list is empty.
      Effect.repeat({
        until: (plugin) => plugin !== undefined,
        schedule: Schedule.spaced("100 millis").pipe(Schedule.upTo({ duration: "10 seconds" })),
      }),
    ),
  );
  if (plugin?.state.status !== "active")
    return yield* failure(
      "OpenCode did not load the Chat agent's configuration. Reconnect to try again.",
    );
});

export const OpenCodeChatLive = Layer.effect(
  ChatBackend,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const http = yield* HttpClient.HttpClient;
    return {
      connect: Effect.gen(function* () {
        yield* prepareChatDirectory().pipe(
          Effect.mapError(() => failure("Could not prepare the app's chat directory.")),
        );
        const executable = findOpenCode();
        // Reuses the user's running service, whatever its version; starts one otherwise.
        const endpoint = yield* Service.ensure({
          command: executable ? [executable, "serve", "--service"] : undefined,
        }).pipe(
          Effect.mapError(() =>
            failure(
              "Could not start OpenCode. Install OpenCode v2 or start its local service, then reconnect.",
            ),
          ),
        );
        const headers = Service.headers(endpoint);
        const authenticated = HttpClient.mapRequest(http, (request) =>
          headers ? HttpClientRequest.setHeaders(request, headers) : request,
        );
        const client = yield* OpenCode.make({ baseUrl: endpoint.url }).pipe(
          Effect.provideService(HttpClient.HttpClient, authenticated),
        );
        yield* checkVersion(client);
        yield* awaitChatPlugin(client);
        return makeOpenCodeConnection(client, authenticated, endpoint.url);
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.timeout("30 seconds"),
        Effect.catchTag("TimeoutError", () =>
          Effect.fail(failure("OpenCode took too long to start. Reconnect to try again.")),
        ),
      ),
    } satisfies ChatBackend;
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
