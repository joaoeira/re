import assert from "node:assert/strict";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { packageName, packLibrary, repoRoot, run } from "./pack-library.mjs";

const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === "--output"),
  "Usage: node scripts/check-desktop.mjs [--output new-directory]",
);
const output = args.length === 2 ? path.resolve(args[1]) : null;
const scratch = await mkdtemp(path.join(tmpdir(), "re-desktop-isolation-"));

try {
  const relative = path.relative(await realpath(repoRoot), await realpath(scratch));
  assert.ok(
    relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    "Desktop must be checked outside the monorepo",
  );
  const app = path.join(await realpath(scratch), "desktop");
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
      "apps/desktop",
    ])
  )
    .split("\0")
    .filter(Boolean);
  for (const file of files) {
    const source = path.join(repoRoot, file);
    const info = await lstat(source).catch((error) => {
      if (error.code === "ENOENT") return null; // An uncommitted deletion.
      throw error;
    });
    if (!info) continue;
    assert.ok(info.isFile(), `Expected an ordinary app file: ${file}`);
    const target = path.join(app, path.relative("apps/desktop", file));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }

  const archive = await packLibrary(path.join(app, "vendor"));
  const manifestPath = path.join(app, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const library = JSON.parse(await run("tar", ["-xOf", archive, "package/package.json"]));
  assert.equal(
    manifest.dependencies[packageName],
    library.version,
    `${packageName} must declare the version delivered by this export`,
  );
  manifest.dependencies[packageName] = `file:vendor/${path.basename(archive)}`;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const env = { ...process.env };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  console.log("Installing Desktop and its library archive outside the monorepo...");
  console.log(await run("npm", ["install", "--no-audit", "--no-fund"], app, env));
  // Exercise the same lockfile-based install used by the extracted app's CI.
  await rm(path.join(app, "node_modules"), { recursive: true, force: true });
  console.log(await run("npm", ["ci", "--no-audit", "--no-fund"], app, env));

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

  console.log(await run("npx", ["--no-install", "playwright", "install", "chromium"], app, env));
  // Native SQLite must work under Node before Forge rebuilds it for Electron.
  console.log(
    await run(
      process.execPath,
      [
        "-e",
        'const Database = require("better-sqlite3"); const db = new Database(":memory:"); db.prepare("SELECT 1").get(); db.close();',
      ],
      app,
      env,
    ),
  );
  for (const command of [
    "lint",
    "typecheck",
    "test",
    "test:install-local",
    "package",
    "test:e2e",
  ]) {
    console.log(`Checking standalone Desktop: ${command}...`);
    const args = ["run", command];
    if (command === "test")
      args.push(
        "--",
        "--reporter=default",
        "--reporter=json",
        "--outputFile=test-results/vitest.json",
      );
    console.log(await run("npm", args, app, env));
    if (command === "test") {
      const results = JSON.parse(
        await readFile(path.join(app, "test-results/vitest.json"), "utf8"),
      );
      assert.equal(
        results.numPendingTests,
        0,
        "Standalone tests must exercise native SQLite without skips",
      );
    }
  }
  assert.ok((await lstat(path.join(app, ".vite/build/main.js"))).size > 0);
  assert.ok((await lstat(path.join(app, ".vite/renderer/main_window/index.html"))).size > 0);
  const { glob } = await import("node:fs/promises");
  const installers = [];
  for await (const file of glob("out/make/**/*.{zip,dmg,deb,rpm,exe}", { cwd: app })) {
    if ((await lstat(path.join(app, file))).size > 0) installers.push(file);
  }
  assert.ok(installers.length > 0, "Forge must produce a platform installer");
  console.log(`Built installers: ${installers.join(", ")}`);

  if (output) {
    await mkdir(path.dirname(output), { recursive: true });
    // Refuse to replace an existing checkout or export.
    await mkdir(output);
    await cp(app, output, {
      recursive: true,
      filter: (source) => path.relative(app, source).split(path.sep)[0] !== "node_modules",
    });
    console.log(`Standalone Desktop exported to ${output}`);
  }
  console.log("Standalone Desktop installation, tests, and production build passed.");
} catch (error) {
  console.error(error.message);
  console.error(`Failed standalone checkout retained at ${scratch}`);
  process.exitCode = 1;
} finally {
  if (!process.exitCode) await rm(scratch, { recursive: true, force: true });
}
