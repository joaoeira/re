import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { packageDirectory, repoRoot, run } from "./pack-library.mjs";

const appRequire = createRequire(path.join(repoRoot, "apps/overlay/package.json"));
const libraryRequire = createRequire(path.join(packageDirectory, "package.json"));

const fixture = async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "re-app-resolution-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const file of [
    "scripts/check-app-resolution.mjs",
    "scripts/pack-library.mjs",
    "packages/re/package.json",
    "apps/overlay/package.json",
  ]) {
    const target = path.join(directory, file);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(repoRoot, file), target);
  }
  await cp(path.join(packageDirectory, "dist"), path.join(directory, "packages/re/dist"), {
    recursive: true,
  });
  for (const [name, installed] of [
    ["effect", path.dirname(appRequire.resolve("effect/package.json"))],
    [
      "@effect/platform-node",
      path.dirname(appRequire.resolve("@effect/platform-node/package.json")),
    ],
    ["ignore", path.dirname(libraryRequire.resolve("ignore/package.json"))],
    ["nanoid", path.dirname(libraryRequire.resolve("nanoid/package.json"))],
    ["ts-fsrs", path.resolve(path.dirname(libraryRequire.resolve("ts-fsrs")), "..")],
    ["@simbyotic/re", path.join(directory, "packages/re")],
  ]) {
    const target = path.join(directory, "node_modules", name);
    await mkdir(path.dirname(target), { recursive: true });
    await symlink(installed, target, "dir");
  }
  return directory;
};

const check = (directory) => run(process.execPath, ["scripts/check-app-resolution.mjs"], directory);

test("the workspace library's five exports run with the application's Effect runtime", async (t) => {
  const directory = await fixture(t);
  assert.match(await check(directory), /all five exports passed/);
});

test("a floating Effect range is rejected even when the installed version currently matches", async (t) => {
  const directory = await fixture(t);
  const filename = path.join(directory, "apps/overlay/package.json");
  const manifest = JSON.parse(await readFile(filename, "utf8"));
  manifest.dependencies.effect = `^${manifest.dependencies.effect}`;
  await writeFile(filename, JSON.stringify(manifest));
  await assert.rejects(check(directory), /Overlay must pin effect/);
});

test("a same-version library outside the workspace cannot satisfy the app dependency", async (t) => {
  const directory = await fixture(t);
  const link = path.join(directory, "node_modules/@simbyotic/re");
  await rm(link);
  await symlink(packageDirectory, link, "dir");
  await assert.rejects(check(directory), /outside the workspace library/);
});

test("a duplicate Effect installation in a transitive Node adapter is rejected", async (t) => {
  const directory = await fixture(t);
  // Keep versions identical: only the physical Effect installation differs.
  const adapter = path.dirname(appRequire.resolve("@effect/platform-node/package.json"));
  const adapterRequire = createRequire(path.join(adapter, "package.json"));
  const shared = path.dirname(adapterRequire.resolve("@effect/platform-node-shared/package.json"));
  const localAdapter = path.join(directory, "node_modules/@effect/platform-node");
  await rm(localAdapter);
  await cp(adapter, localAdapter, {
    recursive: true,
    filter: (file) => path.basename(file) !== "node_modules",
  });
  const localShared = path.join(directory, "node_modules/@effect/platform-node-shared");
  await cp(shared, localShared, {
    recursive: true,
    filter: (file) => path.basename(file) !== "node_modules",
  });
  const duplicate = path.join(localShared, "node_modules/effect");
  await mkdir(path.dirname(duplicate), { recursive: true });
  await cp(path.dirname(appRequire.resolve("effect/package.json")), duplicate, {
    recursive: true,
    filter: (file) => path.basename(file) !== "node_modules",
  });
  await assert.rejects(
    check(directory),
    /Shared Node adapter resolved a different Effect installation/,
  );
});
