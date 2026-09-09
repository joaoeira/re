import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { inspectLibraryArchive, packageName, packLibrary, repoRoot, run } from "./pack-library.mjs";

const supportedEffectVersion = "4.0.0-rc.112";

const checkConsumer = async ({ archive, consumer, withWorkspace }) => {
  await mkdir(consumer);
  // Never copy a local node_modules, lockfile, or stale compiled fixture into the consumer.
  for (const filename of ["package.json", "tsconfig.json", "index.ts", "commonjs.cjs"]) {
    await copyFile(
      path.join(
        repoRoot,
        "test/package-consumer",
        filename === "index.ts" && !withWorkspace ? "scheduler.ts" : filename,
      ),
      path.join(consumer, filename),
    );
  }
  if (withWorkspace) {
    await copyFile(
      path.join(repoRoot, "test/package-consumer/workspace-commonjs.cjs"),
      path.join(consumer, "workspace-commonjs.cjs"),
    );
  }
  const manifestPath = path.join(consumer, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.dependencies.effect, supportedEffectVersion);
  if (!withWorkspace) {
    delete manifest.dependencies["@effect/platform-node"];
  }
  manifest.dependencies[packageName] = pathToFileURL(archive).href;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  // Avoid injected loaders or resolution paths masking broken published JavaScript.
  const env = { ...process.env };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  console.log("Installing archives with npm in an isolated directory...");
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer, env);
  const consumerLock = JSON.parse(await readFile(path.join(consumer, "package-lock.json"), "utf8"));
  for (const installedPath of Object.keys(consumerLock.packages)) {
    assert.doesNotMatch(
      installedPath,
      /(?:^|\/)node_modules\/@effect\/schema$/,
      "The consumer must not install the legacy Schema package",
    );
    assert.doesNotMatch(
      installedPath,
      /(?:^|\/)node_modules\/@effect\/platform$/,
      "The consumer must not install the removed v3 platform package",
    );
    if (!withWorkspace) {
      assert.doesNotMatch(
        installedPath,
        /(?:^|\/)node_modules\/@effect\/platform(?:-[^/]+)?$/,
        "Scheduling must install without filesystem platform dependencies",
      );
    }
  }
  if (!withWorkspace) {
    console.log("Verified scheduler installation has no filesystem platform dependencies.");
  }
  // npm also rejects invalid peers outside the Effect subtree.
  await run("npm", ["ls", "--all", "--json"], consumer, env);
  for (const name of ["effect"]) {
    const installations = await Promise.all(
      (await run("npm", ["ls", name, "--all", "--parseable"], consumer, env))
        .split("\n")
        .map((directory) => realpath(directory)),
    );
    assert.deepEqual(
      installations,
      [path.join(await realpath(consumer), "node_modules", name)],
      `Expected one shared ${name} installation`,
    );
  }
  const installedEffect = JSON.parse(
    await readFile(path.join(consumer, "node_modules/effect/package.json"), "utf8"),
  );
  assert.equal(
    installedEffect.version,
    supportedEffectVersion,
    "Unexpected installed Effect version",
  );
  if (withWorkspace) {
    const adapter = JSON.parse(
      await readFile(
        path.join(consumer, "node_modules/@effect/platform-node/package.json"),
        "utf8",
      ),
    );
    assert.equal(adapter.version, supportedEffectVersion, "The Node adapter must match Effect");
  }
  console.log(
    `Verified shared Effect ${installedEffect.version} (consumer range: ${manifest.dependencies.effect}).`,
  );
  const installed = path.join(consumer, "node_modules", packageName);
  assert.equal(
    await realpath(installed),
    path.join(await realpath(consumer), "node_modules", packageName),
  );
  console.log("Compiling the external TypeScript consumer (NodeNext)...");
  await run(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"],
    consumer,
    env,
  );
  console.log("Checking bundler-style TypeScript resolution...");
  await run(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "-p",
      "tsconfig.json",
      "--module",
      "ES2022",
      "--moduleResolution",
      "Bundler",
      "--noEmit",
    ],
    consumer,
    env,
  );
  console.log("Running the compiled consumer in native Node...");
  console.log(await run(process.execPath, ["dist/index.js"], consumer, env));
  console.log("Running the CommonJS consumer in native Node...");
  console.log(await run(process.execPath, ["commonjs.cjs"], consumer, env));
  if (withWorkspace) {
    console.log(await run(process.execPath, ["workspace-commonjs.cjs"], consumer, env));
  }
};

export const checkPackages = async (archive) => {
  assert.equal(
    process.env.RE_CONSUMER_EFFECT_VERSION ?? supportedEffectVersion,
    supportedEffectVersion,
    `Unsupported consumer Effect version; only ${supportedEffectVersion} is validated`,
  );
  const scratch = await mkdtemp(path.join(tmpdir(), "re-package-consumer-"));
  try {
    const relative = path.relative(await realpath(repoRoot), await realpath(scratch));
    assert.ok(
      relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
      "Consumer must be outside the repository",
    );
    if (archive === undefined) {
      archive = await packLibrary(path.join(scratch, "archives"));
    } else {
      await inspectLibraryArchive(archive);
    }
    console.log("Checking the scheduler consumer...");
    await checkConsumer({
      archive,
      consumer: path.join(scratch, "scheduler-consumer"),
      withWorkspace: false,
    });
    console.log("Checking the workspace consumer...");
    await checkConsumer({
      archive,
      consumer: path.join(scratch, "workspace-consumer"),
      withWorkspace: true,
    });
    console.log("Independent package consumption passed.");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkPackages().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
