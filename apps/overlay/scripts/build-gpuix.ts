import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";

// Build the pinned renderer with our floating element and editor fixes.
// The cache is generated from upstream source plus checked-in patches/extensions.
const revision = "a24b4a42eb516c7b940eb8d34ecebb077df623bd";
const appRoot = resolve(import.meta.dir, "..");
const source = resolve(appRoot, ".cache/gpuix-0.7.0");
const patches = ["gpuix-caret.patch", "gpuix-floating.patch", "gpuix-editor-viewport.patch"].map(
  (name) => resolve(appRoot, "native", name),
);
const extensionRoot = resolve(appRoot, "native/floating");
const extensions = readdirSync(extensionRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => resolve(entry.parentPath, entry.name))
  .sort();
const touchedFiles = [
  ...new Set(
    patches.flatMap((patch) =>
      [...readFileSync(patch, "utf8").matchAll(/^--- a\/(.+)$/gm)].map((match) => match[1]!),
    ),
  ),
];
const output = resolve(appRoot, "dist/gpuix-native.darwin-arm64.node");
const stamp = `${output}.build`;
const cargoArguments = ["build", "--release", "--locked"];
const fingerprint = createHash("sha256")
  .update(revision)
  .update(cargoArguments.join(" "))
  .update(readFileSync(import.meta.path))
  .update([...patches, ...extensions].map((file) => relative(appRoot, file)).join("\n"))
  .update(Buffer.concat([...patches, ...extensions].map((file) => readFileSync(file))))
  .digest("hex");

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("re Overlay currently builds on Apple Silicon macOS only.");
}

if (existsSync(output) && existsSync(stamp) && readFileSync(stamp, "utf8") === fingerprint) {
  console.log("Using cached GPUIX with local extensions.");
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
  // Restore every upstream file named by the patches before reapplying them.
  for (const path of touchedFiles) {
    const original = Bun.spawnSync(["git", "show", `HEAD:${path}`], { cwd: source });
    if (original.exitCode !== 0) throw new Error(`Could not read pinned ${path}`);
    writeFileSync(resolve(source, path), original.stdout);
  }
  for (const patch of patches) run(["git", "apply", patch], source);
  const destination = resolve(source, "packages/native/src/custom_elements/floating");
  // Replace the owned directory so deleted extension files cannot survive in cache.
  rmSync(destination, { recursive: true, force: true });
  cpSync(extensionRoot, destination, { recursive: true });
  // Remove the previous flat extension layout from pre-directory caches.
  for (const name of ["floating.rs", "floating_geometry.rs"]) {
    rmSync(resolve(source, "packages/native/src/custom_elements", name), { force: true });
  }

  run(["cargo", ...cargoArguments], resolve(source, "packages/native"));
  mkdirSync(resolve(output, ".."), { recursive: true });
  copyFileSync(resolve(source, "packages/native/target/release/libgpuix_native.dylib"), output);
  writeFileSync(stamp, fingerprint);
  console.log("Built GPUIX with local extensions.");
}
