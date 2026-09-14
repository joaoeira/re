import { test, expect } from "bun:test";
import { resolve } from "node:path";

process.env.NAPI_RS_NATIVE_LIBRARY_PATH = resolve(
  import.meta.dir,
  "../dist/gpuix-native.darwin-arm64.node",
);
const { createTestRoot } = await import("@gpuix/react/testing");

test("the playground restores unfinished text after clicking outside and reopening", async () => {
  const { PositioningPlayground } = await import("../src/positioning-playground");
  const view = createTestRoot({ width: 720, height: 465 });
  try {
    view.render(<PositioningPlayground keyboard={{ current: () => {} }} onBack={() => {}} />);
    const clickTrigger = () => {
      const b = view.renderer.getElementBounds(view.renderer.findByTestId("comment-trigger")!.id)!;
      view.renderer.nativeSimulateClick(b[0] + 10, b[1] + 10);
    };
    clickTrigger();
    view.renderer.simulateKeystrokes("d r a f t");
    view.renderer.nativeSimulateClick(680, 390);
    expect(view.renderer.findByTestId("comment-editor")).toBeUndefined();
    clickTrigger();
    expect(view.renderer.getPaintedText()).toContain("draft");
  } finally {
    view.unmount();
  }
});
