import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Renders every catalogued window state offscreen through the real GPUI
// pipeline and writes one PNG per state to dist/screens, for comparison
// against the design reference. Pass id fragments to render a subset:
//   bun scripts/screens.tsx 14 15 review
const nativePath = join(import.meta.dir, "../dist/gpuix-native.darwin-arm64.node");
process.env.NAPI_RS_NATIVE_LIBRARY_PATH = nativePath;
const { createTestRoot } = await import("@gpuix/react/testing");
const { screenStates } = await import("../src/screens/catalog");

const output = join(import.meta.dir, "../dist/screens");
mkdirSync(output, { recursive: true });
const filters = process.argv.slice(2);
const selected = screenStates.filter(
  (state) => filters.length === 0 || filters.some((filter) => state.id.includes(filter)),
);

for (const state of selected) {
  const view = createTestRoot({ width: 720, height: 465 });
  view.render(state.render());
  view.renderer.flush();
  if (state.typed) {
    const target = view.renderer.findByTestId(state.typed.testId);
    if (!target) throw new Error(`${state.id}: no element with testId ${state.typed.testId}`);
    view.renderer.focusElement(target.id);
    view.renderer.simulateKeystrokes(state.typed.keys);
  }
  // Card bodies parse Markdown and measure text asynchronously.
  for (let i = 0; i < 10; i++) {
    await Bun.sleep(10);
    view.renderer.flush();
  }
  const file = join(output, `${state.id}.png`);
  view.renderer.captureScreenshot(file);
  view.unmount();
  console.log(`${state.id}  ${state.title}`);
}
console.log(`\n${selected.length} screens written to ${output}`);
