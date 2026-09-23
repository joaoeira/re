import { Select, SelectContent, SelectItem, SelectTrigger } from "@gpuix/react";
import { chatLocked } from "../../chat/model";
import { chatTheme, colors, popover, popoverItem, row } from "../../theme";
import { Icon } from "../../ui/icons";
import type { ChatScreenProps } from "../chat-screen";

type ChatHeaderProps = Pick<
  ChatScreenProps,
  "state" | "picker" | "onPicker" | "onNewChat" | "onSession" | "onModel"
>;

const newChat = "new";

function Picker({
  label,
  value,
  options,
  open,
  disabled,
  onOpen,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly open: boolean;
  readonly disabled: boolean;
  readonly onOpen: (open: boolean) => void;
  readonly onChange: (value: string) => void;
  readonly testId: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={onChange}
      open={open}
      onOpenChange={onOpen}
      disabled={disabled}
    >
      <SelectTrigger
        testId={testId}
        style={{ cursor: disabled ? "default" : "pointer", minWidth: 0, flexShrink: 1 }}
      >
        <div style={{ ...row, gap: 8 }}>
          <text
            style={{
              ...chatTheme.label,
              color: chatTheme.secondary,
              maxWidth: 220,
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {label}
          </text>
          <Icon name="chevron" />
        </div>
      </SelectTrigger>
      <SelectContent
        side="bottom"
        align="start"
        sideOffset={8}
        style={{ ...popover, width: 320, maxHeight: 260, overflowY: "scroll" }}
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            textValue={option.label}
            style={({ highlighted }) => popoverItem(highlighted)}
          >
            <text
              style={{
                ...chatTheme.label,
                color: colors.text,
                minWidth: 0,
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {option.label}
            </text>
            {option.value === value && <text style={{ color: colors.muted }}>✓</text>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ChatHeader({
  state,
  picker,
  onPicker,
  onNewChat,
  onSession,
  onModel,
}: ChatHeaderProps) {
  const locked = chatLocked(state);
  const modelLabel =
    state.models.find((model) => model.key === state.model)?.name ?? state.model ?? "Choose model";
  return (
    <div
      style={{
        ...row,
        justifyContent: "space-between",
        paddingLeft: 28,
        paddingRight: 28,
        paddingTop: 20,
        paddingBottom: 24,
        flexShrink: 0,
        gap: 16,
      }}
    >
      <Picker
        label={state.session?.title ?? "New chat"}
        value={state.session?.id ?? newChat}
        options={[
          { value: newChat, label: "New chat" },
          ...state.sessions.map((session) => ({ value: session.id, label: session.title })),
        ]}
        open={picker === "history"}
        disabled={locked}
        onOpen={(open) => onPicker(open ? "history" : null)}
        onChange={(id) => (id === newChat ? onNewChat() : onSession(id))}
        testId="chat-history"
      />
      <div style={{ ...row, minWidth: 0, flexShrink: 1, opacity: locked ? 0.45 : 1 }}>
        <Picker
          label={modelLabel}
          value={state.model ?? ""}
          options={state.models.map((model) => ({
            value: model.key,
            label: `${model.name} · ${model.provider}`,
          }))}
          open={picker === "model"}
          disabled={locked}
          onOpen={(open) => onPicker(open ? "model" : null)}
          onChange={onModel}
          testId="chat-model"
        />
      </div>
    </div>
  );
}
