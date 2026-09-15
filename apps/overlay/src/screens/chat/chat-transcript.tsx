import type { ChatMessage } from "../../chat/model";
import { CardMarkdown } from "../../card-markdown";
import { chatTheme, colors, column, row } from "../../theme";
import type { ChatScreenProps } from "../chat-screen";

type ChatTranscriptProps = Pick<ChatScreenProps, "state" | "onStop">;

type TranscriptItem =
  | { readonly kind: "message"; readonly message: ChatMessage; readonly writing: boolean }
  | { readonly kind: "activity" };

function transcriptItems(messages: readonly ChatMessage[], working: boolean): TranscriptItem[] {
  const items: TranscriptItem[] = messages.map((message, index) => ({
    kind: "message",
    message,
    writing: working && index === messages.length - 1,
  }));
  if (working) {
    const lastUser = messages.reduce(
      (last, message, index) => (message.role === "user" ? index : last),
      -1,
    );
    items.splice(lastUser + 1, 0, { kind: "activity" });
  }
  return items;
}

export function ChatTranscript({ state, onStop }: ChatTranscriptProps) {
  const messages = state.messages.filter((message) => message.parts.some((part) => part.text));
  const working = state.running && state.connection === "ready";
  const items = transcriptItems(messages, working);
  const activity = (
    <div
      testId="chat-activity"
      style={{ ...row, justifyContent: "space-between", gap: 8, paddingBottom: 24 }}
    >
      <text testId="chat-status" style={{ ...chatTheme.label, color: chatTheme.secondary }}>
        {state.stopping ? "Stopping…" : (state.activity ?? "Working…")}
      </text>
      <div
        testId="chat-stop"
        onClick={state.stopping ? undefined : onStop}
        style={{
          ...row,
          gap: 8,
          cursor: state.stopping ? "default" : "pointer",
          opacity: state.stopping ? 0.45 : 1,
        }}
      >
        <div style={{ width: 8, height: 8, borderWidth: 1, borderColor: chatTheme.secondary }} />
        <text style={{ ...chatTheme.label, color: colors.text }}>Stop</text>
      </div>
    </div>
  );
  const renderedItems = items.map((item) =>
    item.kind === "activity" ? (
      <div key="activity" style={{ paddingLeft: 28, paddingRight: 28 }}>
        {activity}
      </div>
    ) : (
      <div
        key={item.message.id}
        style={{
          ...column,
          width: "100%",
          paddingLeft: 28,
          paddingRight: 28,
          paddingBottom: 24,
        }}
      >
        {item.message.role === "user" ? (
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
              <text style={{ ...chatTheme.body, color: colors.text }}>
                {item.message.parts.map((part) => part.text).join("\n\n")}
              </text>
            </div>
          </div>
        ) : (
          <div style={{ ...column, paddingRight: 24, gap: 8 }}>
            <CardMarkdown
              source={item.message.parts.map((part) => part.text).join("\n\n")}
              fontFamily={chatTheme.fontFamily}
            />
            {item.writing && (
              <text style={{ ...chatTheme.label, fontSize: 11, color: colors.muted }}>
                Writing…
              </text>
            )}
          </div>
        )}
      </div>
    ),
  );
  return messages.length === 0 ? (
    <div style={{ ...column, flexGrow: 1, gap: 8 }}>
      <div style={{ ...column, paddingLeft: 28, paddingRight: 28, gap: 8 }}>
        <text style={{ ...chatTheme.body, color: colors.text }}>
          What would you like to work through?
        </text>
        <text style={{ ...chatTheme.body, color: chatTheme.secondary }}>
          Ask a question to start a conversation.
        </text>
      </div>
      {renderedItems}
    </div>
  ) : (
    <virtual-list
      key={state.session?.id}
      alignment="top"
      followTail
      estimatedItemHeight={80}
      style={{ flexGrow: 1, minHeight: 0 }}
    >
      {renderedItems}
    </virtual-list>
  );
}
