import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Published 0.7.0 predates the upstream caret fix. Keep its exact dependency
// revision and backport only that fix until a compatible release includes it.
const revision = "a24b4a42eb516c7b940eb8d34ecebb077df623bd";
const appRoot = resolve(import.meta.dir, "..");
const source = resolve(appRoot, ".cache/gpuix-0.7.0");
const patch = resolve(appRoot, "native/gpuix-caret.patch");
const output = resolve(appRoot, "dist/gpuix-native.darwin-arm64.node");
const stamp = `${output}.build`;
const cargoArguments = ["build", "--release", "--locked"];
const fingerprint = createHash("sha256")
  .update(revision)
  .update(cargoArguments.join(" "))
  .update(readFileSync(patch))
  .digest("hex");

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("re Pocket currently builds on Apple Silicon macOS only.");
}

if (existsSync(output) && existsSync(stamp) && readFileSync(stamp, "utf8") === fingerprint) {
  console.log("Using cached GPUIX with the caret fix.");
} else {
  const run = (args: string[], cwd = appRoot) => {
    const result = Bun.spawnSync(args, { cwd, stdout: "inherit", stderr: "inherit" });
    if (result.exitCode !== 0) throw new Error(`Command failed: ${args.join(" ")}`);
  };

  if (!existsSync(`${source}/.git`)) {
    mkdirSync(resolve(source, ".."), { recursive: true });
    run([
      "git",
      "clone",
      "--depth",
      "1",
      "--branch",
      "@gpuix/react@0.7.0",
      "https://github.com/remorses/gpuix.git",
      source,
    ]);
  }
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: source });
  if (head.exitCode !== 0 || head.stdout.toString().trim() !== revision) {
    throw new Error(`Unexpected GPUIX revision in ${source}; expected ${revision}.`);
  }
  run(["git", "submodule", "update", "--init", "--depth", "1", "zed"], source);
  const alreadyPatched =
    Bun.spawnSync(["git", "apply", "--reverse", "--check", patch], {
      cwd: source,
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0;
  if (!alreadyPatched) run(["git", "apply", patch], source);

  run(["cargo", ...cargoArguments], resolve(source, "packages/native"));
  mkdirSync(resolve(output, ".."), { recursive: true });
  copyFileSync(resolve(source, "packages/native/target/release/libgpuix_native.dylib"), output);
  writeFileSync(stamp, fingerprint);
  console.log("Built GPUIX with the caret fix.");
}
