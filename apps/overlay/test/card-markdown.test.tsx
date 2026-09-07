import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// These assertions exercise actual GPUI layout. The scheduling suite remains
// runnable without a local macOS build; test:rendering builds this prerequisite.
const nativePath = resolve(import.meta.dir, "../dist/gpuix-native.darwin-arm64.node");
const nativeTest =
  process.platform === "darwin" &&
  existsSync(nativePath) &&
  existsSync(resolve(import.meta.dir, "../dist/libpanel.dylib"))
    ? test
    : test.skip;

async function setup(width: number) {
  process.env.NAPI_RS_NATIVE_LIBRARY_PATH = nativePath;
  const { createTestRoot } = await import("@gpuix/react/testing");
  const { CardMarkdown } = await import("../src/card-markdown");
  const view = createTestRoot({ width, height: 300 });
  return { view, CardMarkdown };
}

async function settle(view: Awaited<ReturnType<typeof setup>>["view"], count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await Bun.sleep(10);
    view.renderer.flush();
    if (view.renderer.findByType("img").length === count) return;
  }
  throw new Error("Formula images did not finish rendering");
}

nativeTest("adding inline math preserves body and heading text size", async () => {
  const { view, CardMarkdown } = await setup(600);
  try {
    view.render(
      <div style={{ width: 600, display: "flex", flexDirection: "column" }}>
        <CardMarkdown testId="plain" source="About 0" />
        <CardMarkdown testId="math" source="About $0$" />
        <CardMarkdown testId="plain-heading" source="## About 0" />
        <CardMarkdown testId="math-heading" source="## About $0$" />
      </div>,
    );
    await settle(view, 2);
    const height = (id: string) =>
      view.renderer.getElementBounds(view.renderer.findByTestId(id)!.id)![3]!;
    expect(height("math")).toBeCloseTo(height("plain"), 0);
    expect(height("math-heading")).toBeCloseTo(height("plain-heading"), 0);
  } finally {
    view.unmount();
  }
});

nativeTest(
  "wrapping keeps punctuation with its formula and honors explicit line breaks",
  async () => {
    const { view, CardMarkdown } = await setup(200);
    try {
      for (const width of [48, 64, 70, 72, 96, 128]) {
        view.render(
          <div style={{ width }}>
            <CardMarkdown source={"Before $V_{DD}$, after.  \nNext"} />
          </div>,
        );
        await settle(view, 1);
        const bounds = (id: number) => view.renderer.getElementBounds(id)!;
        const image = bounds(view.renderer.findByType("img")[0]!.id);
        const comma = bounds(view.renderer.findByText(",")!.id);
        const after = bounds(view.renderer.findByText("after.")!.id);
        const next = bounds(view.renderer.findByText("Next")!.id);
        expect(comma[0]!).toBeGreaterThanOrEqual(image[0]! + image[2]! - 1);
        expect(Math.abs(comma[1]! - image[1]!)).toBeLessThan(10);
        expect(next[1]!).toBeGreaterThanOrEqual(after[1]! + after[3]! - 1);
      }
    } finally {
      view.unmount();
    }
  },
);
