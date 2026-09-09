import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { checkAppResolution } from "./check-app-resolution.mjs";
import { repoRoot } from "./pack-library.mjs";

const exec = promisify(execFile);

await checkAppResolution();
assert.ok(
  process.platform === "darwin" && process.arch === "arm64",
  "Full Overlay validation requires Apple Silicon macOS with Rust, Xcode and Metal tooling.",
);
const app = path.join(repoRoot, "apps/overlay");
for (const command of ["typecheck", "build", "test", "test:rendering"]) {
  console.log(`Checking Overlay: ${command}...`);
  const { stdout, stderr } = await exec("bun", ["run", command], {
    cwd: app,
    maxBuffer: 10 * 1024 * 1024,
  });
  console.log(stdout + stderr);
  if (command === "test:rendering") {
    assert.match(stderr, /\b[1-9]\d* pass\b/, "Rendering tests must execute");
    assert.doesNotMatch(stderr, /\b[1-9]\d* skip\b/, "Native rendering checks must not be skipped");
  }
}
for (const file of [
  "dist/gpuix-native.darwin-arm64.node",
  "dist/libpanel.dylib",
  "dist/re Pocket.app/Contents/MacOS/re-pocket",
  "dist/re Pocket.app/Contents/Frameworks/libpanel.dylib",
]) {
  assert.ok((await stat(path.join(app, file))).size > 0, `Missing Overlay output: ${file}`);
}
console.log("Overlay frozen-library resolution, native build and tests passed.");
