import type { ReactNode } from "react";
import type { ChatMessage } from "../../chat/model";
import { CardMarkdown } from "../../card-markdown";
import { chatTheme, colors, column, row } from "../../theme";
import type { ChatScreenProps } from "../chat-screen";

type ChatTranscriptProps = Pick<ChatScreenProps, "state" | "onStop">;

type TranscriptItem =
  | { readonly kind: "message"; readonly message: ChatMessage; readonly writing: boolean }
  | { readonly kind: "activity" };

// The activity row sits directly under the prompt it answers, above any text streaming in.
function transcriptItems(messages: readonly ChatMessage[], working: boolean): TranscriptItem[] {
  const items: TranscriptItem[] = messages.map((message, index) => ({
    kind: "message",
    message,
    writing: working && index === messages.length - 1,
  }));
  if (working) {
    const lastUser = messages.map((message) => message.role).lastIndexOf("user");
    items.splice(lastUser + 1, 0, { kind: "activity" });
  }
  return items;
}

const messageText = (message: ChatMessage) => message.parts.map((part) => part.text).join("\n\n");

function Gutter({ children }: { readonly children: ReactNode }) {
  return (
    <div style={{ ...column, width: "100%", paddingLeft: 28, paddingRight: 28, paddingBottom: 24 }}>
      {children}
    </div>
  );
}

function UserMessage({ message }: { readonly message: ChatMessage }) {
  return (
    <div style={{ ...row, width: "100%", justifyContent: "flex-end", paddingLeft: 24 }}>
      <div
        style={{
          ...column,
          maxWidth: "100%",
          flexShrink: 1,
          backgroundColor: colors.field,
          borderRadius: 5,
          paddingTop: 10,
          paddingBottom: 10,
          paddingLeft: 12,
          paddingRight: 12,
        }}
      >
        <text style={{ ...chatTheme.body, color: colors.text }}>{messageText(message)}</text>
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  writing,
}: {
  readonly message: ChatMessage;
  readonly writing: boolean;
}) {
  return (
    <div style={{ ...column, paddingRight: 24, gap: 8 }}>
      <CardMarkdown source={messageText(message)} fontFamily={chatTheme.fontFamily} />
      {writing && (
        <text style={{ ...chatTheme.label, fontSize: 11, color: colors.muted }}>Writing…</text>
      )}
    </div>
  );
}

function Activity({
  label,
  stopping,
  onStop,
}: {
  readonly label: string;
  readonly stopping: boolean;
  readonly onStop: () => void;
}) {
  return (
    <div testId="chat-activity" style={{ ...row, justifyContent: "space-between", gap: 8 }}>
      <text style={{ ...chatTheme.label, color: chatTheme.secondary }}>{label}</text>
      <div
        testId="chat-stop"
        onClick={stopping ? undefined : onStop}
        style={{
          ...row,
          gap: 8,
          cursor: stopping ? "default" : "pointer",
          opacity: stopping ? 0.45 : 1,
        }}
      >
        <div style={{ width: 8, height: 8, borderWidth: 1, borderColor: chatTheme.secondary }} />
        <text style={{ ...chatTheme.label, color: colors.text }}>Stop</text>
      </div>
    </div>
  );
}

export function ChatTranscript({ state, onStop }: ChatTranscriptProps) {
  const messages = state.messages.filter((message) => message.parts.some((part) => part.text));
  const working = state.running && state.connection === "ready";
  const rendered = transcriptItems(messages, working).map((item) =>
    item.kind === "activity" ? (
      <Gutter key="activity">
        <Activity
          label={state.stopping ? "Stopping…" : (state.activity ?? "Working…")}
          stopping={state.stopping}
          onStop={onStop}
        />
      </Gutter>
    ) : (
      <Gutter key={item.message.id}>
        {item.message.role === "user" ? (
          <UserMessage message={item.message} />
        ) : (
          <AssistantMessage message={item.message} writing={item.writing} />
        )}
      </Gutter>
    ),
  );
  if (messages.length > 0)
    return (
      <virtual-list
        key={state.session?.id}
        alignment="top"
        followTail
        estimatedItemHeight={80}
        style={{ flexGrow: 1, minHeight: 0 }}
      >
        {rendered}
      </virtual-list>
    );
  return (
    <div style={{ ...column, flexGrow: 1, gap: 8 }}>
      <div style={{ ...column, paddingLeft: 28, paddingRight: 28, gap: 8 }}>
        <text style={{ ...chatTheme.body, color: colors.text }}>
          What would you like to work through?
        </text>
        <text style={{ ...chatTheme.body, color: chatTheme.secondary }}>
          Ask a question to start a conversation.
        </text>
      </div>
      {rendered}
    </div>
  );
}
