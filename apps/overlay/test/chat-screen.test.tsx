import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { initialChatState, type ChatState } from "../src/chat/model";
import { ChatScreen } from "../src/screens/chat-screen";

process.env.NAPI_RS_NATIVE_LIBRARY_PATH = resolve(
  import.meta.dir,
  "../dist/gpuix-native.darwin-arm64.node",
);
const { createTestRoot } = await import("@gpuix/react/testing");

function composer() {
  const view = createTestRoot({ width: 720, height: 465 });
  let draft = "";
  const sent: string[] = [];
  const noop = () => {};
  return {
    sent,
    draft: () => draft,
    type: (keys: string) => view.renderer.simulateKeystrokes(keys),
    close: () => view.unmount(),
    render: (state: ChatState) => {
      view.render(
        <ChatScreen
          state={state}
          picker={null}
          onPicker={noop}
          onDraft={(text) => {
            draft = text;
          }}
          onSend={() => sent.push(draft)}
          onNewChat={noop}
          onSession={noop}
          onModel={noop}
          onReconnect={noop}
          onStop={noop}
        />,
      );
      view.renderer.focusElement(view.renderer.findByTestId("chat-composer")!.id);
    },
  };
}

test("Shift Enter inserts a newline and Enter submits the composed text", () => {
  const editor = composer();
  try {
    editor.render({ ...initialChatState, connection: "ready" });
    editor.type("h i shift-enter t h e r e enter");
    expect(editor.sent).toEqual(["hi\nthere"]);
  } finally {
    editor.close();
  }
});

test("the native composer rejects typing and submission while a response is running", () => {
  const editor = composer();
  try {
    editor.render({ ...initialChatState, connection: "ready", running: true });
    editor.type("x enter");
    expect(editor.draft()).toBe("");
    expect(editor.sent).toHaveLength(0);
  } finally {
    editor.close();
  }
});

test("the inline Stop control cancels once and becomes inactive while stopping", () => {
  const view = createTestRoot({ width: 720, height: 465 });
  const noop = () => {};
  let stops = 0;
  const render = (stopping: boolean) =>
    view.render(
      <ChatScreen
        state={{ ...initialChatState, connection: "ready", running: true, stopping }}
        picker={null}
        onPicker={noop}
        onDraft={noop}
        onSend={noop}
        onNewChat={noop}
        onSession={noop}
        onModel={noop}
        onReconnect={noop}
        onStop={() => {
          stops++;
        }}
      />,
    );
  const clickStop = () => {
    const [x, y, width, height] = view.renderer.getElementBounds(
      view.renderer.findByTestId("chat-stop")!.id,
    )!;
    view.renderer.nativeSimulateClick(x! + width! / 2, y! + height! / 2);
  };
  try {
    render(false);
    clickStop();
    expect(stops).toBe(1);
    render(true);
    clickStop();
    expect(stops).toBe(1);
  } finally {
    view.unmount();
  }
});
