import { dlopen, FFIType } from "bun:ffi";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("re Pocket currently requires Apple Silicon macOS.");
}

const developmentLibrary = resolve(import.meta.dir, "../dist/libpanel.dylib");
const libraryPath = existsSync(developmentLibrary)
  ? developmentLibrary
  : resolve(dirname(process.execPath), "../Frameworks/libpanel.dylib");
const library = dlopen(libraryPath, {
  re_panel_take_route: { args: [], returns: FFIType.i32 },
  re_panel_show: { args: [], returns: FFIType.void },
  re_panel_pump: { args: [], returns: FFIType.void },
  re_panel_init: { args: [], returns: FFIType.i32 },
  re_panel_hide: { args: [], returns: FFIType.void },
  re_panel_pin: { args: [FFIType.bool], returns: FFIType.void },
  re_panel_dispose: { args: [], returns: FFIType.void },
});
// Mirrors RE_PANEL_ROUTE_QUIT in native/panel.m.
const ROUTE_QUIT = 1;

export const panel = {
  takeRoute: (): "quit" | null =>
    library.symbols.re_panel_take_route() === ROUTE_QUIT ? "quit" : null,
  show: () => library.symbols.re_panel_show(),
  // The frame loop stops when a tick returns false; quitting goes through routes instead.
  pump: () => {
    library.symbols.re_panel_pump();
    return true;
  },
  initialize: () => library.symbols.re_panel_init(),
  hide: () => library.symbols.re_panel_hide(),
  pin: (value: boolean) => library.symbols.re_panel_pin(value),
  dispose: () => library.symbols.re_panel_dispose(),
};
