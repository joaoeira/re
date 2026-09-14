/** @jsxImportSource @gpuix/react */
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
const output = resolve(import.meta.dir, "../dist/positioning-research");
mkdirSync(output, { recursive: true });
process.env.NAPI_RS_NATIVE_LIBRARY_PATH = resolve(
  import.meta.dir,
  "../dist/gpuix-native.darwin-arm64.node",
);
const { createTestRoot } = await import("@gpuix/react/testing");
const view = createTestRoot({ width: 720, height: 465 });
const bounds = (name: string) =>
  view.renderer.getElementBounds(view.renderer.findByTestId(name)!.id);
try {
  for (const fit of ["snap", "switch"] as const) {
    for (const top of [80, 330]) {
      view.render(
        <div style={{ width: 720, height: 465, position: "relative" }}>
          <div
            testId="card"
            style={{
              position: "absolute",
              left: 160,
              top,
              width: 440,
              height: 100,
              backgroundColor: "#262626",
            }}
          >
            <anchored side="bottom" align="end" gap={8} fit={fit} snapMargin={12} deferred>
              <div testId="popup" style={{ width: 340, height: 100, backgroundColor: "#303030" }}>
                <text>Comment</text>
              </div>
            </anchored>
          </div>
        </div>,
      );
      console.log(
        JSON.stringify({ case: "fit", fit, top, card: bounds("card"), popup: bounds("popup") }),
      );
    }
  }
  for (const value of [
    "Short",
    "One\nTwo\nThree",
    Array.from({ length: 12 }, (_, i) => `Line ${i}`).join("\n"),
    "A sentence that wraps around the editor. ".repeat(15),
  ]) {
    view.render(
      <div style={{ width: 720, height: 465 }}>
        <textarea
          testId="editor"
          value={value}
          minRows={1}
          maxRows={4}
          style={{ width: 340, fontSize: 14, lineHeight: 20, padding: 8 }}
        />
      </div>,
    );
    console.log(
      JSON.stringify({ case: "textarea", length: value.length, bounds: bounds("editor") }),
    );
  }
  view.render(
    <div style={{ width: 720, height: 465 }}>
      <div testId="scroller" style={{ width: 600, height: 200, overflowY: "scroll" }}>
        <div style={{ height: 80, flexShrink: 0 }} />
        <div
          testId="card"
          style={{
            position: "relative",
            width: 440,
            height: 100,
            flexShrink: 0,
            backgroundColor: "#262626",
          }}
        >
          <anchored side="bottom" align="end" gap={8} fit="snap" deferred>
            <div testId="popup" style={{ width: 340, height: 100, backgroundColor: "#303030" }}>
              <text>Comment</text>
            </div>
          </anchored>
        </div>
        <div style={{ height: 500, flexShrink: 0 }} />
      </div>
    </div>,
  );
  console.log(
    JSON.stringify({ case: "before scroll", card: bounds("card"), popup: bounds("popup") }),
  );
  view.renderer.nativeSimulateScrollWheel(30, 50, 0, -40);
  console.log(
    JSON.stringify({ case: "after scroll", card: bounds("card"), popup: bounds("popup") }),
  );
  console.log(
    JSON.stringify({ case: "outside scroller painted", text: view.renderer.getPaintedText() }),
  );
  for (const top of [20, 330]) {
    view.render(
      <div style={{ width: 720, height: 465, position: "relative" }}>
        <div
          testId="card"
          style={{ position: "absolute", left: 160, top, width: 440, height: 100 }}
        >
          <anchored side="top" align="end" gap={8} fit="snap" deferred>
            <div testId="popup" style={{ width: 340, height: 100, backgroundColor: "#303030" }} />
          </anchored>
        </div>
      </div>,
    );
    console.log(
      JSON.stringify({ case: "explicit top", top, card: bounds("card"), popup: bounds("popup") }),
    );
  }
  for (const maxHeight of [undefined, 70]) {
    view.render(
      <div style={{ width: 720, height: 465 }}>
        <textarea
          testId="editor"
          value={"One\nTwo\nThree\nFour\nFive\nSix"}
          minRows={1}
          maxRows={4}
          style={{
            width: 340,
            maxHeight,
            padding: 8,
            color: "#FFFFFF",
            backgroundColor: "#303030",
          }}
        />
      </div>,
    );
    console.log(
      JSON.stringify({
        case: "editor maxHeight",
        maxHeight,
        bounds: bounds("editor"),
        painted: view.renderer.getPaintedText(),
      }),
    );
    if (maxHeight) view.renderer.captureScreenshot(resolve(output, "positioning-maxheight.png"));
  }
  view.render(
    <div style={{ width: 720, height: 465 }}>
      <div testId="scroller" style={{ width: 600, height: 300, overflowY: "scroll" }}>
        <div testId="card" style={{ position: "relative", width: 440, height: 100, flexShrink: 0 }}>
          <anchored side="bottom" align="end" gap={8} deferred>
            <div testId="popup" style={{ width: 340, backgroundColor: "#303030" }}>
              <textarea
                testId="editor"
                value={"First\nSecond\nThird\nFourth\nFifth\nSixth"}
                minRows={1}
                maxRows={2}
                style={{ color: "#FFFFFF" }}
              />
            </div>
          </anchored>
        </div>
        <div style={{ height: 600, flexShrink: 0 }} />
      </div>
    </div>,
  );
  const scroller = view.renderer.findByTestId("scroller")!.id;
  const editor = bounds("editor")!;
  console.log(
    JSON.stringify({
      case: "editor wheel before",
      parentScroll: view.renderer.getScrollOffset(scroller),
      painted: view.renderer.getPaintedText(),
      editor,
    }),
  );
  view.renderer.captureScreenshot(resolve(output, "positioning-scroll-before.png"));
  view.renderer.nativeSimulateScrollWheel(editor[0] + 20, editor[1] + 10, 0, 40);
  console.log(
    JSON.stringify({
      case: "editor wheel after",
      parentScroll: view.renderer.getScrollOffset(scroller),
      painted: view.renderer.getPaintedText(),
    }),
  );
  view.renderer.captureScreenshot(resolve(output, "positioning-scroll-after.png"));
} finally {
  view.unmount();
}
