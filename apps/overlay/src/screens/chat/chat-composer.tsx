import { useState } from "react";
import { chatLocked } from "../../chat/model";
import { chatTheme, colors, column, editorTheme, row } from "../../theme";
import type { ChatScreenProps } from "../chat-screen";

type ChatComposerProps = Pick<ChatScreenProps, "state" | "onDraft" | "onSend" | "onReconnect">;

export function ChatComposer({ state, onDraft, onSend, onReconnect }: ChatComposerProps) {
  const [focused, setFocused] = useState(false);
  const locked = chatLocked(state);
  const status =
    state.connection === "initial" || state.connection === "connecting"
      ? "Connecting to OpenCode…"
      : state.connection === "disconnected"
        ? "Connection lost"
        : state.outcome === "interrupted"
          ? "Stopped. You can send another message when you’re ready."
          : undefined;

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
      {(status || state.error) && (
        <div style={{ ...column, gap: 8, paddingTop: 12, paddingBottom: 12 }}>
          <text
            testId="chat-status"
            style={{
              ...chatTheme.label,
              color: colors.text,
            }}
          >
            {status ?? "Response failed"}
          </text>
          {state.error && (
            <text style={{ ...chatTheme.body, color: chatTheme.secondary }}>{state.error}</text>
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
      )}
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
        theme={{
          ...editorTheme,
          fontSans: chatTheme.fontFamily,
          bg: locked ? chatTheme.disabledField : colors.field,
        }}
        style={{
          ...chatTheme.body,
          height: 74,
          color: colors.text,
          backgroundColor: locked ? chatTheme.disabledField : colors.field,
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
