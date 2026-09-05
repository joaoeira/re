import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { libraries, packLibraries, repoRoot, run } from "./pack-libraries.mjs";

const checkConsumer = async ({ archives, consumer, withWorkspace }) => {
  const includedLibraries = withWorkspace ? libraries : ["core", "item-types", "scheduler"];
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
  const manifestPath = path.join(consumer, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.dependencies.effect =
    process.env.RE_CONSUMER_EFFECT_VERSION ?? manifest.dependencies.effect;
  if (!withWorkspace) {
    delete manifest.dependencies["@effect/platform"];
    delete manifest.dependencies["@effect/platform-node"];
  }
  for (const library of includedLibraries) {
    const name = `@re/${library}`;
    manifest.dependencies[name] = pathToFileURL(archives[name]).href;
  }
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
    if (!withWorkspace) {
      assert.doesNotMatch(
        installedPath,
        /(?:^|\/)node_modules\/(?:@re\/workspace|@effect\/platform(?:-[^/]+)?|ignore)$/,
        "Scheduling must install without workspace or filesystem platform dependencies",
      );
    }
  }
  if (!withWorkspace) {
    console.log(
      "Verified scheduler installation has no workspace or filesystem platform dependencies.",
    );
  }
  for (const name of withWorkspace ? ["effect", "@effect/platform"] : ["effect"]) {
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
  console.log(
    `Verified shared Effect ${installedEffect.version} (consumer range: ${manifest.dependencies.effect}).`,
  );
  for (const library of includedLibraries) {
    const installed = path.join(consumer, "node_modules/@re", library);
    assert.equal(
      await realpath(installed),
      path.join(await realpath(consumer), "node_modules/@re", library),
    );
  }
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
};

const scratch = await mkdtemp(path.join(tmpdir(), "re-package-consumer-"));
try {
  const relative = path.relative(await realpath(repoRoot), await realpath(scratch));
  assert.ok(
    relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    "Consumer must be outside the repository",
  );
  const archives = await packLibraries(path.join(scratch, "archives"));
  console.log("Checking the scheduler consumer...");
  await checkConsumer({
    archives,
    consumer: path.join(scratch, "scheduler-consumer"),
    withWorkspace: false,
  });
  console.log("Checking the workspace consumer...");
  await checkConsumer({
    archives,
    consumer: path.join(scratch, "workspace-consumer"),
    withWorkspace: true,
  });
  console.log("Independent package consumption passed.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
