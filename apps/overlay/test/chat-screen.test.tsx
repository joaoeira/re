import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { initialChatState, type ChatState } from "../src/chat/model";
import { ChatScreen } from "../src/screens/chat-screen";

process.env.NAPI_RS_NATIVE_LIBRARY_PATH = resolve(
  import.meta.dir,
  "../dist/gpuix-native.darwin-arm64.node",
);
const { createTestRoot } = await import("@gpuix/react/testing");

const ready: ChatState = { ...initialChatState, connection: "ready" };

function mount() {
  const view = createTestRoot({ width: 720, height: 465 });
  let draft = "";
  const sent: string[] = [];
  let stops = 0;
  const noop = () => {};
  const bounds = (testId: string) =>
    view.renderer.getElementBounds(view.renderer.findByTestId(testId)!.id)!;
  return {
    sent,
    draft: () => draft,
    stops: () => stops,
    render: (state: ChatState) =>
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
          onStop={() => {
            stops++;
          }}
        />,
      ),
    type: (keys: string) => {
      view.renderer.focusElement(view.renderer.findByTestId("chat-composer")!.id);
      view.renderer.simulateKeystrokes(keys);
    },
    click: (testId: string) => {
      const [x, y, width, height] = bounds(testId);
      view.renderer.nativeSimulateClick(x! + width! / 2, y! + height! / 2);
    },
    close: () => view.unmount(),
  };
}

test("Shift Enter inserts a newline and Enter submits the composed text", () => {
  const screen = mount();
  try {
    screen.render(ready);
    screen.type("h i shift-enter t h e r e enter");
    expect(screen.sent).toEqual(["hi\nthere"]);
  } finally {
    screen.close();
  }
});

test("the native composer rejects typing and submission while a response is running", () => {
  const screen = mount();
  try {
    screen.render({ ...ready, running: true });
    screen.type("x enter");
    expect(screen.draft()).toBe("");
    expect(screen.sent).toHaveLength(0);
  } finally {
    screen.close();
  }
});

test("the inline Stop control cancels once and becomes inactive while stopping", () => {
  const screen = mount();
  try {
    screen.render({ ...ready, running: true });
    screen.click("chat-stop");
    expect(screen.stops()).toBe(1);
    screen.render({ ...ready, running: true, stopping: true });
    screen.click("chat-stop");
    expect(screen.stops()).toBe(1);
  } finally {
    screen.close();
  }
});
