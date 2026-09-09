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

nativeTest("cloze flow diagrams retain their rows and indentation through reveal", async () => {
  const { view, CardMarkdown } = await setup(600);
  const { prepareScratch } = await import("../src/workspace");
  try {
    for (const indent of ["    ", "\t", " \t"]) {
      const prepared = prepareScratch({
        type: "cloze",
        content: [
          "{{c1::virtual address}}",
          `${indent}↓ {{c2::page-table}} translation`,
          "{{c3::physical address}}",
          `${indent}↓ {{c4::memory-controller}} translation`,
          "{{c5::DRAM location}}",
        ].join("\n"),
      });
      if (!prepared.ok) throw new Error(prepared.error);
      const card = prepared.value[3]!;
      for (const width of [600, 190]) {
        for (const source of [card.question, card.answer]) {
          view.render(
            <div style={{ width }}>
              <CardMarkdown source={source} />
            </div>,
          );
          const rows = view.renderer.findByType("markdown");
          expect(rows).toHaveLength(5);
          const bounds = rows.map((row) => view.renderer.getElementBounds(row.id)!);
          for (let i = 1; i < bounds.length; i++) {
            expect(bounds[i]![1]!).toBeGreaterThanOrEqual(
              bounds[i - 1]![1]! + bounds[i - 1]![3]! - 1,
            );
          }
          expect(bounds[1]![0]!).toBeGreaterThan(bounds[0]![0]!);
          expect(bounds[3]![0]).toBe(bounds[1]![0]);
          expect(bounds[2]![0]).toBe(bounds[0]![0]);
          expect(bounds[4]![0]).toBe(bounds[0]![0]);
          const painted = view.renderer.getPaintedText().join(" ");
          expect(painted).toContain(source === card.question ? "[...]" : "memory-controller");
          expect(painted).not.toContain("{{c");
          expect(painted).not.toContain("**");
        }
      }
    }
  } finally {
    view.unmount();
  }
});

nativeTest("ordinary paragraph wrapping and explicit Markdown blocks stay intact", async () => {
  const { view, CardMarkdown } = await setup(600);
  try {
    const prose = "An ordinary sentence\n    continues on the next source line.";
    const diagram = "Input\n    ↓ conversion\nOutput";
    const height = () =>
      view.renderer.getElementBounds(view.renderer.findByTestId("content")!.id)![3]!;
    for (const source of [
      prose,
      `- ${diagram.replaceAll("\n", "\n  ")}`,
      "**Input\n    ↓ conversion\nOutput**",
    ]) {
      view.render(
        <div style={{ width: 600 }}>
          <CardMarkdown testId="content" source={source} />
        </div>,
      );
      const originalHeight = height();
      const originalText = view.renderer.getPaintedText().join(" ");
      view.render(
        <div style={{ width: 600 }}>
          <CardMarkdown
            testId="content"
            source={source.replace(/\n +/g, " ").replaceAll("\n", " ")}
          />
        </div>,
      );
      expect(height()).toBe(originalHeight);
      expect(view.renderer.getPaintedText().join(" ")).toBe(originalText);
      expect(originalText).not.toContain("**");
    }
    view.render(
      <div style={{ width: 600 }}>
        <CardMarkdown testId="content" source={`\`\`\`text\n${diagram}\n\`\`\``} />
      </div>,
    );
    expect(height()).toBeGreaterThanOrEqual(3 * 22);
    const code = view.renderer.getPaintedText().join("\n");
    expect(code).toContain("Input");
    expect(code).toContain("    ↓ conversion");
    expect(code).toContain("Output");
  } finally {
    view.unmount();
  }
});
