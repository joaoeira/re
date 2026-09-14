import { resolve } from "node:path";

process.env.NAPI_RS_NATIVE_LIBRARY_PATH = resolve(
  import.meta.dir,
  "../dist/gpuix-native.darwin-arm64.node",
);
const { render } = await import("@gpuix/react");
const { PositioningPlayground } = await import("../src/positioning-playground");
const keyboard = { current: (_event: import("@gpuix/react").EventPayload) => {} };

// A separate window/process allows experimenting without closing a study session.
render(<PositioningPlayground keyboard={keyboard} onBack={() => process.exit(0)} />, {
  title: "re — Positioning playground",
  width: 720,
  height: 465,
  minWidth: 300,
  minHeight: 300,
  onKeyDown: (event) => {
    if (event.modifiers?.cmd && event.key === "q") process.exit(0);
    keyboard.current(event);
  },
});
