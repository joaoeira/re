import { initialChatState, type ChatState } from "../chat/model";
import { ChatScreen, chatFooterCommands } from "./chat-screen";
import { Shell } from "./shell";
import type { ScreenState } from "./catalog";

const noop = () => {};
const ready: ChatState = {
  ...initialChatState,
  connection: "ready",
  model: "openai/gpt-5.4",
  models: [{ key: "openai/gpt-5.4", name: "GPT-5.4", provider: "openai" }],
  sessions: [{ id: "first", title: "Learning and memory" }],
};
const conversation: ChatState = {
  ...ready,
  session: ready.sessions[0],
  messages: [
    {
      id: "intro",
      role: "assistant",
      parts: [
        {
          ordinal: 0,
          text: "Spacing gives you a chance to retrieve a memory after some forgetting. That effort makes it easier to recall later.",
          complete: true,
        },
      ],
    },
    {
      id: "user",
      role: "user",
      parts: [{ ordinal: 0, text: "Make that simpler.", complete: true }],
    },
    {
      id: "assistant",
      role: "assistant",
      parts: [
        {
          ordinal: 0,
          text: "Leave time between reviews. Remembering something after a break helps it stick.",
          complete: true,
        },
      ],
    },
  ],
};
const fixture = (id: string, title: string, state: ChatState): ScreenState => ({
  id,
  title,
  render: () => (
    <Shell
      onBack={noop}
      onActions={noop}
      notice={null}
      footer={{ context: "Chat", commands: chatFooterCommands(state, noop) }}
    >
      <ChatScreen
        state={state}
        picker={null}
        onPicker={noop}
        onDraft={noop}
        onSend={noop}
        onNewChat={noop}
        onSession={noop}
        onModel={noop}
        onReconnect={noop}
        onStop={noop}
      />
    </Shell>
  ),
});
export const chatScreenStates: readonly ScreenState[] = [
  fixture("37-chat-empty", "Chat · New conversation", ready),
  fixture("38-chat-ready", "Chat · Ready to send", {
    ...conversation,
    draft: "How should I choose the next interval?",
  }),
  fixture("39-chat-working", "Chat · Responding", {
    ...conversation,
    running: true,
    activity: "Responding…",
  }),
  fixture("40-chat-disconnected", "Chat · Connection lost", {
    ...conversation,
    connection: "disconnected",
    error: "The agent may still be working. Your received messages are kept.",
  }),
];
