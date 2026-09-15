import { useEffect, useState } from "react";
import { flushSync } from "@gpuix/react";
import { chatActions, observeChat } from "../workspace";
import { initialChatState } from "./model";

export function useChat(active: boolean) {
  const [state, setState] = useState(initialChatState);
  const [picker, setPicker] = useState<"model" | "history" | null>(null);
  useEffect(() => {
    if (!active) return;
    const cancel = observeChat((value) => flushSync(() => setState(value)));
    void chatActions.start();
    return () => {
      cancel();
      setPicker(null);
    };
  }, [active]);
  return { state, actions: chatActions, picker, setPicker };
}
