import assert from "node:assert/strict";
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { packageName, repoRoot, run } from "./pack-library.mjs";

import { prepareFrozenApp, verifyFrozenApp } from "./frozen-library.mjs";

const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === "--output"),
  "Usage: node scripts/check-raycast.mjs [--output new-directory]",
);
const output = args.length === 2 ? path.resolve(args[1]) : null;
const scratch = await mkdtemp(path.join(tmpdir(), "re-raycast-isolation-"));

try {
  const relative = path.relative(await realpath(repoRoot), await realpath(scratch));
  assert.ok(
    relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    "Raycast must be checked outside the monorepo",
  );
  const app = path.join(await realpath(scratch), "raycast");
  await mkdir(app);
  // Copy source and app-owned configuration, including new files under review.
  // Git's exclusions prevent node_modules, generated builds, and local secrets from leaking in.
  const files = (
    await run("git", [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "apps/raycast",
    ])
  )
    .split("\0")
    .filter(Boolean);
  for (const file of files) {
    const source = path.join(repoRoot, file);
    assert.ok((await lstat(source)).isFile(), `Expected an ordinary app file: ${file}`);
    const target = path.join(app, path.relative("apps/raycast", file));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }

  const frozen = await prepareFrozenApp(app);
  const manifest = JSON.parse(await readFile(path.join(app, "package.json"), "utf8"));

  const env = { ...process.env };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  console.log("Installing Raycast and its library archive outside the monorepo...");
  console.log(
    await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], app, env),
  );
  // Exercise the same lockfile-based install used by the extracted app's CI.
  await rm(path.join(app, "node_modules"), { recursive: true, force: true });
  console.log(await run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], app, env));

  const lock = JSON.parse(await readFile(path.join(app, "package-lock.json"), "utf8"));
  for (const [name, entry] of Object.entries(lock.packages)) {
    assert.ok(!entry.link, `Workspace link in standalone installation: ${name}`);
    if (entry.resolved?.startsWith("file:")) {
      assert.match(
        entry.resolved,
        /^file:vendor\/[^/]+\.tgz$/,
        `Nonportable file dependency: ${name}`,
      );
    }
  }
  for (const name of [packageName]) {
    const installed = path.join(app, "node_modules", name);
    assert.equal(await realpath(installed), installed, `${name} must be installed, not linked`);
  }
  await verifyFrozenApp(app, frozen);
  for (const name of ["effect", "@effect/platform", "react"]) {
    const installed = await Promise.all(
      (await run("npm", ["ls", name, "--all", "--parseable"], app, env))
        .split("\n")
        .map((directory) => realpath(directory)),
    );
    assert.deepEqual(
      installed,
      [path.join(app, "node_modules", name)],
      `Expected one shared ${name} installation`,
    );
  }

  for (const command of ["lint", "fmt:check", "typecheck", "test", "build"]) {
    console.log(`Checking standalone Raycast: ${command}...`);
    console.log(await run("npm", ["run", command], app, env));
  }
  const built = JSON.parse(await readFile(path.join(app, "dist/package.json"), "utf8"));
  assert.deepEqual(
    built.commands.map(({ name }) => name),
    manifest.commands.map(({ name }) => name),
  );
  for (const { name } of manifest.commands) {
    assert.ok(
      (await lstat(path.join(app, "dist", `${name}.js`))).size > 0,
      `Missing command bundle: ${name}`,
    );
  }
  assert.ok((await lstat(path.join(app, "dist/assets", manifest.icon))).size > 0);

  if (output) {
    await mkdir(path.dirname(output), { recursive: true });
    // Refuse to replace an existing checkout or export.
    await mkdir(output);
    await cp(app, output, {
      recursive: true,
      filter: (source) => path.relative(app, source).split(path.sep)[0] !== "node_modules",
    });
    console.log(`Standalone Raycast exported to ${output}`);
  }
  console.log("Standalone Raycast installation, tests, and production build passed.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
