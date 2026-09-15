import type { ChatState } from "../chat/model";
import { chatTheme, column } from "../theme";
import { ChatHeader } from "./chat/chat-header";
import { ChatTranscript } from "./chat/chat-transcript";
import { ChatComposer } from "./chat/chat-composer";

export interface ChatScreenProps {
  readonly state: ChatState;
  readonly picker: "model" | "history" | null;
  readonly onPicker: (picker: "model" | "history" | null) => void;
  readonly onDraft: (text: string) => void;
  readonly onSend: () => void;
  readonly onNewChat: () => void;
  readonly onSession: (id: string) => void;
  readonly onModel: (key: string) => void;
  readonly onReconnect: () => void;
  readonly onStop: () => void;
}

/** Props-only composition; state transitions and OpenCode calls belong to ChatStore. */
export function ChatScreen(props: ChatScreenProps) {
  return (
    <div
      testId="chat-screen"
      style={{
        ...column,
        flexGrow: 1,
        minHeight: 0,
        fontWeight: 400,
        fontFamily: chatTheme.fontFamily,
      }}
    >
      <ChatHeader
        state={props.state}
        picker={props.picker}
        onPicker={props.onPicker}
        onNewChat={props.onNewChat}
        onSession={props.onSession}
        onModel={props.onModel}
      />
      <ChatTranscript state={props.state} onStop={props.onStop} />
      <ChatComposer
        state={props.state}
        onDraft={props.onDraft}
        onSend={props.onSend}
        onReconnect={props.onReconnect}
      />
    </div>
  );
}
