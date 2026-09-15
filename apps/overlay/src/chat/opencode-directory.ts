import { join } from "node:path";
import { Effect, FileSystem } from "effect";
import { Agent } from "@opencode/client/effect";
import { supportDirectory } from "../storage";

export const chatDirectory = join(supportDirectory, "chat");
export const chatAgent = Agent.ID.make("overlay-chat");
export const chatPermissions = [{ action: "*", resource: "*", effect: "deny" as const }];
const system =
  "You are a helpful conversational assistant. Answer the user's request clearly and directly. You have no tools in this chat.";

// Agent.system alone does not replace OpenCode's coding context. This location-scoped
// hook also removes tools, so this proof of concept cannot pause on permissions/forms.
const plugin = `export default {
  id: "re.overlay.chat",
  async setup(ctx) {
    await ctx.session.hook("context", event => {
      if (event.agent !== "overlay-chat") return;
      event.system = [{ type: "text", text: ${JSON.stringify(system)} }];
      event.tools = {};
    });
  }
};\n`;

export const prepareChatDirectory = Effect.fn("Chat.prepareDirectory")(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(chatDirectory, { recursive: true });
  const writeChanged = (path: string, contents: string) =>
    Effect.gen(function* () {
      if ((yield* fs.exists(path)) && (yield* fs.readFileString(path)) === contents) return;
      const temporary = `${path}.${process.pid}.tmp`;
      yield* fs.writeFileString(temporary, contents);
      yield* fs.rename(temporary, path);
    });
  const pluginDirectory = join(chatDirectory, ".opencode", "plugins");
  yield* fs.makeDirectory(pluginDirectory, { recursive: true });
  const pluginPath = join(pluginDirectory, "chat-agent.js");
  yield* writeChanged(pluginPath, plugin);
  yield* writeChanged(
    join(chatDirectory, "opencode.jsonc"),
    JSON.stringify(
      {
        share: "disabled",
        snapshots: false,
        agents: { [chatAgent]: { system, permissions: chatPermissions } },
      },
      null,
      2,
    ),
  );
});
