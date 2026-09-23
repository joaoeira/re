import { useEffect, useState } from "react";
import { flushSync } from "@gpuix/react";
import { chatActions, observeChat } from "../workspace";
import type { ChatPicker } from "../screens/chat-screen";
import { chatLocked, initialChatState } from "./model";

export function useChat(active: boolean) {
  const [state, setState] = useState(initialChatState);
  const [picker, setPicker] = useState<ChatPicker | null>(null);
  useEffect(() => {
    if (!active) return;
    const cancel = observeChat((value) =>
      flushSync(() => {
        setState(value);
        // An open picker swallows shortcuts; it must not outlive the controls it belongs to.
        if (chatLocked(value)) setPicker(null);
      }),
    );
    void chatActions.start();
    return () => {
      cancel();
      setPicker(null);
    };
  }, [active]);
  return { state, actions: chatActions, picker, setPicker };
}
