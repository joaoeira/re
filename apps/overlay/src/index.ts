import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

// GPUIX's renderer is a Node-API module. Bun can neither embed nor import a
// .node file as an asset, so resolve it like libpanel: from dist while
// developing, or from the app bundle's Frameworks folder when compiled.
const developmentModule = resolve(import.meta.dir, "../dist/gpuix-native.darwin-arm64.node");
process.env.NAPI_RS_NATIVE_LIBRARY_PATH = existsSync(developmentModule)
  ? developmentModule
  : resolve(dirname(process.execPath), "../Frameworks/gpuix-native.darwin-arm64.node");
await import("./window");
