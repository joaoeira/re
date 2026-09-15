export interface ChatModel {
  readonly key: string;
  readonly name: string;
  readonly provider: string;
}

export interface ChatSession {
  readonly id: string;
  readonly title: string;
  readonly model?: string;
}

export interface ChatText {
  readonly ordinal: number;
  readonly text: string;
  readonly complete: boolean;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly parts: readonly ChatText[];
  readonly error?: string;
}

export interface ChatSnapshot {
  readonly session: ChatSession;
  readonly messages: readonly ChatMessage[];
  readonly running: boolean;
  readonly pendingIDs: readonly string[];
  readonly outcome?: "succeeded" | "failed" | "interrupted";
}

export interface ChatState {
  readonly connection: "initial" | "connecting" | "ready" | "disconnected";
  readonly sessions: readonly ChatSession[];
  readonly models: readonly ChatModel[];
  readonly session?: ChatSession;
  readonly model?: string;
  readonly messages: readonly ChatMessage[];
  readonly draft: string;
  readonly running: boolean;
  readonly changing: boolean;
  readonly stopping: boolean;
  readonly activity?: string;
  readonly error?: string;
  readonly outcome?: ChatSnapshot["outcome"];
}

export const initialChatState: ChatState = {
  connection: "initial",
  sessions: [],
  models: [],
  messages: [],
  draft: "",
  running: false,
  changing: false,
  stopping: false,
};

export const chatLocked = (state: ChatState): boolean =>
  state.connection !== "ready" || state.running || state.changing;

export type ChatEvent =
  | { readonly type: "connected" }
  | { readonly type: "started"; readonly sessionID: string }
  | { readonly type: "finished"; readonly sessionID: string; readonly error?: string }
  | { readonly type: "activity"; readonly sessionID: string; readonly text: string }
  | {
      readonly type: "text";
      readonly sessionID: string;
      readonly messageID: string;
      readonly ordinal: number;
      readonly text: string;
      readonly complete: boolean;
    };

export function receiveText(
  messages: readonly ChatMessage[],
  event: Extract<ChatEvent, { type: "text" }>,
): readonly ChatMessage[] {
  const existing = messages.find((message) => message.id === event.messageID);
  const previous = existing?.parts.find((part) => part.ordinal === event.ordinal);
  // A restored, completed part can overlap buffered live events. Never append those twice.
  if (previous?.complete && !event.complete) return messages;
  const part: ChatText = {
    ordinal: event.ordinal,
    text: event.complete ? event.text : (previous?.text ?? "") + event.text,
    complete: event.complete,
  };
  const message: ChatMessage = {
    id: event.messageID,
    role: "assistant",
    parts: [
      ...(existing?.parts.filter((value) => value.ordinal !== event.ordinal) ?? []),
      part,
    ].sort((a, b) => a.ordinal - b.ordinal),
  };
  return existing
    ? messages.map((value) => (value.id === message.id ? message : value))
    : [...messages, message];
}
