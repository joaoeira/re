import nativePath from "../dist/gpuix-native.darwin-arm64.node" with { type: "file" };

// Bun embeds this native asset into the standalone executable. Select it before
// importing React/GPUIX so development and bundled runs use the same renderer.
process.env.NAPI_RS_NATIVE_LIBRARY_PATH = nativePath;
await import("./app");
