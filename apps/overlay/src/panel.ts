import { CString, dlopen, FFIType, ptr } from "bun:ffi";
import { menuRoutes, type MenuRoute, type StatusMenu } from "./review-status";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("re Overlay currently requires Apple Silicon macOS.");
}

const developmentLibrary = resolve(import.meta.dir, "../dist/libpanel.dylib");
const libraryPath = existsSync(developmentLibrary)
  ? developmentLibrary
  : resolve(dirname(process.execPath), "../Frameworks/libpanel.dylib");
const library = dlopen(libraryPath, {
  re_text_baseline: { args: [FFIType.ptr, FFIType.f64, FFIType.f64], returns: FFIType.f64 },
  re_panel_set_status: { args: [FFIType.ptr], returns: FFIType.void },
  re_panel_choose_workspace: { args: [], returns: FFIType.ptr },
  re_panel_take_route: { args: [], returns: FFIType.i32 },
  re_panel_show: { args: [], returns: FFIType.void },
  re_panel_pump: { args: [], returns: FFIType.void },
  re_panel_init: { args: [], returns: FFIType.i32 },
  re_panel_hide: { args: [], returns: FFIType.void },
  re_panel_pin: { args: [FFIType.bool], returns: FFIType.void },
  re_panel_dispose: { args: [], returns: FFIType.void },
  re_register_fonts: { args: [FFIType.ptr], returns: FFIType.i32 },
});

// Registered before any renderer exists so GPUI's first family lookup sees them.
const developmentFonts = resolve(import.meta.dir, "../fonts");
const fontsDirectory = existsSync(developmentFonts)
  ? developmentFonts
  : resolve(dirname(process.execPath), "../Resources/fonts");
export const registeredFonts = library.symbols.re_register_fonts(
  ptr(Buffer.from(`${fontsDirectory}\0`)),
);

const baselines = new Map<string, number>();
export function textBaseline(family: string, size: number, lineHeight: number): number {
  const key = `${family}:${size}:${lineHeight}`;
  const previous = baselines.get(key);
  if (previous !== undefined) return previous;
  const name = Buffer.from(`${family}\0`);
  const baseline = library.symbols.re_text_baseline(ptr(name), size, lineHeight);
  baselines.set(key, baseline);
  return baseline;
}

export const panel = {
  takeRoute: (): MenuRoute | null => {
    const route = library.symbols.re_panel_take_route();
    return (
      (Object.keys(menuRoutes) as MenuRoute[]).find((key) => menuRoutes[key] === route) ?? null
    );
  },
  setStatus: (model: StatusMenu) => {
    const json = Buffer.from(`${JSON.stringify(model)}\0`);
    library.symbols.re_panel_set_status(ptr(json));
  },
  chooseWorkspace: (): string | null => {
    const path = library.symbols.re_panel_choose_workspace();
    return path ? new CString(path).toString() : null;
  },
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
