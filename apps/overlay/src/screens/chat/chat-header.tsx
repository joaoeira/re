import { Select, SelectContent, SelectItem, SelectTrigger } from "@gpuix/react";
import { chatLocked } from "../../chat/model";
import { chatTheme, colors, popover, popoverItem, row } from "../../theme";
import { Icon } from "../../ui/icons";
import type { ChatScreenProps } from "../chat-screen";

type ChatHeaderProps = Pick<
  ChatScreenProps,
  "state" | "picker" | "onPicker" | "onNewChat" | "onSession" | "onModel"
>;

function Picker({
  label,
  value,
  options,
  open,
  onOpen,
  onChange,
  side,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly open: boolean;
  readonly onOpen: (open: boolean) => void;
  readonly onChange: (value: string) => void;
  readonly side: "top" | "bottom";
  readonly testId: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} open={open} onOpenChange={onOpen}>
      <SelectTrigger testId={testId} style={{ cursor: "pointer", minWidth: 0, flexShrink: 1 }}>
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
        side={side}
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
        value={state.session?.id ?? ""}
        options={[
          { value: "new", label: "New chat" },
          ...state.sessions.map((session) => ({ value: session.id, label: session.title })),
        ]}
        open={!locked && picker === "history"}
        onOpen={(open) => {
          if (!locked) onPicker(open ? "history" : null);
        }}
        onChange={(id) => (id === "new" ? onNewChat() : onSession(id))}
        side="bottom"
        testId="chat-history"
      />
      {locked ? (
        <div style={{ ...row, gap: 8, opacity: 0.45 }}>
          <text style={{ ...chatTheme.label, color: colors.muted }}>{modelLabel}</text>
          <Icon name="chevron" />
        </div>
      ) : (
        <Picker
          label={modelLabel}
          value={state.model ?? ""}
          options={state.models.map((model) => ({
            value: model.key,
            label: `${model.name} · ${model.provider}`,
          }))}
          open={picker === "model"}
          onOpen={(open) => onPicker(open ? "model" : null)}
          onChange={onModel}
          side="bottom"
          testId="chat-model"
        />
      )}
    </div>
  );
}
