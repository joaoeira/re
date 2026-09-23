import { useState } from "react";
import { chatLocked, type ChatState } from "../../chat/model";
import { chatTheme, colors, column, editorTheme, row } from "../../theme";
import type { ChatScreenProps } from "../chat-screen";

type ChatComposerProps = Pick<ChatScreenProps, "state" | "onDraft" | "onSend" | "onReconnect">;

function statusHeading(state: ChatState): string | undefined {
  switch (state.connection) {
    case "initial":
    case "connecting":
      return "Connecting to OpenCode…";
    case "disconnected":
      return "Connection lost";
    case "ready":
      if (state.outcome === "interrupted")
        return "Stopped. You can send another message when you’re ready.";
      if (state.outcome === "failed" && state.error) return "Response failed";
      return undefined;
  }
}

function Status({ state, onReconnect }: Pick<ChatComposerProps, "state" | "onReconnect">) {
  const heading = statusHeading(state);
  if (!heading && !state.error) return null;
  return (
    <div style={{ ...column, gap: 8, paddingTop: 12, paddingBottom: 12 }}>
      {heading && (
        <text testId="chat-status" style={{ ...chatTheme.label, color: colors.text }}>
          {heading}
        </text>
      )}
      {state.error && (
        <text testId="chat-error" style={{ ...chatTheme.body, color: chatTheme.secondary }}>
          {state.error}
        </text>
      )}
      {state.connection === "disconnected" && (
        <div style={row}>
          <div
            testId="chat-reconnect"
            onClick={onReconnect}
            style={{
              borderWidth: 1,
              borderColor: colors.focus,
              borderRadius: 4,
              backgroundColor: chatTheme.recoveryButton,
              paddingTop: 5,
              paddingBottom: 5,
              paddingLeft: 10,
              paddingRight: 10,
              cursor: "pointer",
            }}
          >
            <text style={{ ...chatTheme.label, color: colors.text }}>Reconnect</text>
          </div>
        </div>
      )}
    </div>
  );
}

export function ChatComposer({ state, onDraft, onSend, onReconnect }: ChatComposerProps) {
  const [focused, setFocused] = useState(false);
  const locked = chatLocked(state);
  const field = locked ? chatTheme.disabledField : colors.field;

  return (
    <div
      style={{
        ...column,
        paddingLeft: 28,
        paddingRight: 28,
        paddingBottom: 18,
        gap: 14,
        flexShrink: 0,
      }}
    >
      <Status state={state} onReconnect={onReconnect} />
      <textarea
        testId="chat-composer"
        value={state.draft}
        readOnly={locked}
        autoFocus
        minRows={2}
        maxRows={2}
        placeholder={state.running ? "Wait for the response to finish…" : "Write a message…"}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onDraft(event.value ?? "")}
        onSubmit={locked ? undefined : onSend}
        theme={{ ...editorTheme, fontSans: chatTheme.fontFamily, bg: field }}
        style={{
          ...chatTheme.body,
          height: 74,
          color: colors.text,
          backgroundColor: field,
          borderWidth: 1,
          borderColor: !locked && focused ? colors.focus : chatTheme.idleBorder,
          borderRadius: 5,
          paddingTop: 13,
          paddingBottom: 13,
          paddingLeft: 14,
          paddingRight: 14,
          width: "100%",
        }}
      />
      {state.connection === "ready" && state.models.length === 0 && (
        <text style={{ ...chatTheme.label, color: colors.error }}>
          No configured models are available in OpenCode.
        </text>
      )}
    </div>
  );
}
