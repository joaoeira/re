import { test, expect } from "bun:test";
import { resolve } from "node:path";
import { Floating } from "../src/floating/floating";
import { useState } from "react";

process.env.NAPI_RS_NATIVE_LIBRARY_PATH = resolve(
  import.meta.dir,
  "../dist/gpuix-native.darwin-arm64.node",
);
const { createTestRoot } = await import("@gpuix/react/testing");

test("an empty usable area suppresses the popup instead of painting over reserved UI", () => {
  const view = createTestRoot({ width: 300, height: 300 });
  try {
    view.render(
      <div style={{ width: 300, height: 300 }}>
        <Floating
          open
          boundaryInsets={{ top: 200, bottom: 200 }}
          reference={<div style={{ width: 100, height: 40 }} />}
        >
          <div testId="content" style={{ height: 50 }}>
            <text>No room</text>
          </div>
        </Floating>
      </div>,
    );
    expect(view.renderer.getElementBounds(view.renderer.findByTestId("content")!.id)).toBeNull();
  } finally {
    view.unmount();
  }
});

test("a popup near the window bottom opens above its reference without moving the reference", () => {
  const view = createTestRoot({ width: 720, height: 465 });
  try {
    view.render(
      <div style={{ width: 720, height: 465 }}>
        <div style={{ position: "absolute", left: 160, top: 330 }}>
          <Floating open reference={<div testId="card" style={{ width: 440, height: 100 }} />}>
            <div testId="content" style={{ height: 100 }}>
              <text>Any content</text>
            </div>
          </Floating>
        </div>
      </div>,
    );
    const bounds = (id: string) =>
      view.renderer.getElementBounds(view.renderer.findByTestId(id)!.id)!;
    expect(bounds("card").slice(0, 2)).toEqual([160, 330]);
    expect(bounds("content").slice(0, 2)).toEqual([260, 222]); // Card right − popup width; card top − gap − height.
  } finally {
    view.unmount();
  }
});

test("scrolling the editor changes the visible text without scrolling its parent", () => {
  const view = createTestRoot({ width: 720, height: 465 });
  let edited = "one\ntwo\nthree\nfour\nfive\nsix";
  try {
    view.render(
      <div style={{ width: 720, height: 465 }}>
        <div testId="scroller" style={{ width: 600, height: 300, overflowY: "scroll" }}>
          <Floating open reference={<div style={{ width: 440, height: 100 }} />}>
            <textarea
              testId="editor"
              value={edited}
              onChange={(e) => {
                edited = e.value ?? "";
              }}
              minRows={1}
              maxRows={2}
            />
          </Floating>
          <div style={{ height: 600, flexShrink: 0 }} />
        </div>
      </div>,
    );
    const editor = view.renderer.getElementBounds(view.renderer.findByTestId("editor")!.id)!;
    view.renderer.nativeSimulateScrollWheel(editor[0] + 8, editor[1] + 8, 0, editor[3]);
    view.renderer.nativeSimulateClick(editor[0] + 8, editor[1] + editor[3] - 5);
    view.renderer.simulateKeystrokes("cmd-right x");
    expect(edited).toBe("one\ntwo\nthree\nfourx\nfive\nsix");
    expect(view.renderer.getScrollOffset(view.renderer.findByTestId("scroller")!.id)).toEqual([
      0, 0,
    ]);
  } finally {
    view.unmount();
  }
});

test("arbitrary popup actions receive hits instead of the covered page, while outside clicks dismiss", () => {
  const view = createTestRoot({ width: 720, height: 465 });
  let behind = 0;
  let activated = 0;
  let dismissed = 0;
  try {
    view.render(
      <div style={{ width: 720, height: 465 }}>
        <div
          onClick={() => behind++}
          style={{
            position: "absolute",
            left: 260,
            top: 110,
            width: 340,
            height: 80,
            backgroundColor: "#222222",
          }}
        />
        <div style={{ position: "absolute", left: 160, top: 40 }}>
          <Floating
            open
            onClickOutside={() => dismissed++}
            reference={<div style={{ width: 440, height: 60 }} />}
          >
            <div onClick={() => activated++} style={{ height: 80 }}>
              <text>Run action</text>
            </div>
          </Floating>
        </div>
      </div>,
    );
    view.renderer.nativeSimulateClick(300, 140);
    expect(activated).toBe(1);
    expect(behind).toBe(0);
    expect(dismissed).toBe(0);
    view.renderer.nativeSimulateClick(680, 400);
    expect(dismissed).toBe(1);
  } finally {
    view.unmount();
  }
});

test("typing can flip the editor without losing focus, and shortening it keeps the chosen side", () => {
  const view = createTestRoot({ width: 720, height: 465 });
  let submitted = "";
  function Scene() {
    const [value, setValue] = useState("");
    return (
      <div style={{ width: 720, height: 465 }}>
        <div style={{ position: "absolute", left: 160, top: 240 }}>
          <Floating open reference={<div style={{ width: 440, height: 100 }} />}>
            <textarea
              testId="editor"
              autoFocus
              value={value}
              minRows={1}
              maxRows={8}
              onChange={(e) => setValue(e.value ?? "")}
              onSubmit={(e) => {
                submitted = e.value ?? "";
              }}
              style={{ minHeight: 0 }}
            />
          </Floating>
        </div>
      </div>
    );
  }
  try {
    view.render(<Scene />);
    const bounds = () => view.renderer.getElementBounds(view.renderer.findByTestId("editor")!.id)!;
    expect(bounds()[1]).toBe(348); // Reference bottom 340 + gap 8.
    view.renderer.simulateKeystrokes("a shift-enter b shift-enter c shift-enter d shift-enter e");
    expect(bounds()[1]).toBeLessThan(240);
    view.renderer.simulateKeystrokes("cmd-a x");
    const shortened = bounds();
    expect(shortened[1] + shortened[3]).toBe(232); // Reference top 240 − gap 8.
    view.renderer.simulateKeystrokes("enter");
    expect(submitted).toBe("x");
  } finally {
    view.unmount();
  }
});

test("a popup follows scrolling outside the scroller clip, then dismisses when its reference leaves view", () => {
  const view = createTestRoot({ width: 720, height: 465 });
  function Scene() {
    const [open, setOpen] = useState(true);
    return (
      <div style={{ width: 720, height: 465 }}>
        <div testId="scroller" style={{ width: 600, height: 180, overflowY: "scroll" }}>
          <div style={{ height: 40, flexShrink: 0 }} />
          <Floating
            open={open}
            onReferenceHidden={() => setOpen(false)}
            reference={<div testId="card" style={{ width: 440, height: 100 }} />}
          >
            <div testId="content" style={{ height: 60 }}>
              <text>Floating content</text>
            </div>
          </Floating>
          <div style={{ height: 600, flexShrink: 0 }} />
        </div>
      </div>
    );
  }
  try {
    view.render(<Scene />);
    const scroller = view.renderer.findByTestId("scroller")!.id;
    view.renderer.scrollTo(scroller, 0, -30);
    const content = view.renderer.findByTestId("content")!;
    expect(view.renderer.getElementBounds(content.id)![1]).toBe(118); // Reference bottom 140 − scroll 30 + gap 8.
    view.renderer.scrollTo(scroller, 0, -200);
    view.renderer.dispatchNativeEvents();
    expect(view.renderer.findByTestId("content")).toBeUndefined();
  } finally {
    view.unmount();
  }
});

test("content narrows and shifts inside the usable window without covering reserved chrome", () => {
  const view = createTestRoot({ width: 300, height: 300 });
  try {
    view.render(
      <div style={{ width: 300, height: 300 }}>
        <div style={{ position: "absolute", left: 10, top: 100 }}>
          <Floating
            open
            width={340}
            collisionPadding={16}
            boundaryInsets={{ left: 40, right: 20, bottom: 60 }}
            reference={<div style={{ width: 100, height: 40 }} />}
          >
            <div testId="content" style={{ height: 100 }}>
              <text>Arbitrary content</text>
            </div>
          </Floating>
        </div>
      </div>,
    );
    const b = view.renderer.getElementBounds(view.renderer.findByTestId("content")!.id)!;
    expect(b[0]).toBe(56); // Left inset 40 + collision padding 16.
    expect(b[2]).toBe(208); // Window 300 − insets 40 and 20 − two paddings of 16.
    expect(b[1] + b[3]).toBeLessThanOrEqual(224); // Window 300 − bottom inset 60 − padding 16.
  } finally {
    view.unmount();
  }
});

test("a height-constrained editor keeps its final line reachable above a fixed action", () => {
  const view = createTestRoot({ width: 720, height: 465 });
  let edited = "one\ntwo\nthree\nfour\nfive\nsix";
  try {
    view.render(
      <div style={{ width: 720, height: 465 }}>
        <div style={{ position: "absolute", left: 160, top: 40 }}>
          <Floating open maxHeight={90} reference={<div style={{ width: 440, height: 100 }} />}>
            <textarea
              testId="editor"
              autoFocus
              value={edited}
              onChange={(e) => {
                edited = e.value ?? "";
              }}
              minRows={1}
              maxRows={8}
              style={{ minHeight: 0, flexShrink: 1 }}
            />
            <div testId="action" style={{ height: 24, flexShrink: 0 }}>
              <text>Save</text>
            </div>
          </Floating>
        </div>
      </div>,
    );
    const bounds = (id: string) =>
      view.renderer.getElementBounds(view.renderer.findByTestId(id)!.id)!;
    const editor = bounds("editor");
    const action = bounds("action");
    expect(action[1] + action[3]).toBeLessThanOrEqual(238); // Reference bottom 140 + gap 8 + height cap 90.
    view.renderer.nativeSimulateClick(editor[0] + 8, editor[1] + editor[3] - 5);
    view.renderer.simulateKeystrokes("cmd-right x");
    expect(edited).toBe("one\ntwo\nthree\nfour\nfive\nsixx");
  } finally {
    view.unmount();
  }
});
