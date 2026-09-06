import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { repoRoot, run } from "./pack-library.mjs";

const exec = promisify(execFile);
const temporary = async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "re-release-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

test("preparing a release writes its changelog and updates both app pins without versioning apps", async (t) => {
  const directory = await temporary(t);
  for (const file of [
    "package.json",
    "bun.lock",
    ".changeset/config.json",
    "scripts/pack-library.mjs",
    "scripts/prepare-library-release.mjs",
    "packages/re/package.json",
    "apps/desktop/package.json",
    "apps/raycast/package.json",
  ]) {
    const target = path.join(directory, file);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(repoRoot, file), target);
  }
  await symlink(path.join(repoRoot, "node_modules"), path.join(directory, "node_modules"), "dir");
  await writeFile(path.join(directory, ".gitignore"), "node_modules\n");
  await run("git", ["init", "--initial-branch=master"], directory);
  await run("git", ["add", "."], directory);
  await run(
    "git",
    [
      "-c",
      "user.name=Release Test",
      "-c",
      "user.email=release-test@example.invalid",
      "commit",
      "-m",
      "fixture",
    ],
    directory,
  );
  const original = JSON.parse(
    await readFile(path.join(directory, "packages/re/package.json"), "utf8"),
  );
  const [major, minor, patch] = original.version.split(".").map(Number);
  const expected = `${major}.${minor}.${patch + 1}`;
  await writeFile(
    path.join(directory, ".changeset/test-change.md"),
    `---\n"${original.name}": patch\n---\n\nPreserve card data when updating a deck.\n`,
  );
  await run(process.execPath, ["scripts/prepare-library-release.mjs"], directory);
  const manifest = JSON.parse(
    await readFile(path.join(directory, "packages", "re", "package.json"), "utf8"),
  );
  assert.equal(manifest.version, expected);
  assert.ok(
    (await readFile(path.join(directory, "packages", "re", "CHANGELOG.md"), "utf8")).includes(
      `## ${expected}`,
    ),
  );
  for (const app of ["desktop", "raycast"]) {
    const consumer = JSON.parse(
      await readFile(path.join(directory, "apps", app, "package.json"), "utf8"),
    );
    const before = JSON.parse(
      await readFile(path.join(repoRoot, "apps", app, "package.json"), "utf8"),
    );
    assert.equal(consumer.dependencies[manifest.name], expected);
    assert.equal(consumer.version, before.version);
  }
  // A subsequent frozen install must accept the lockfile produced by preparation.
  await run(
    "bun",
    ["install", "--lockfile-only", "--frozen-lockfile", "--ignore-scripts"],
    directory,
  );
});

const releaseFixture = async (t) => {
  const directory = await temporary(t);
  const source = path.join(directory, "source");
  await mkdir(path.join(source, "package"), { recursive: true });
  const manifest = JSON.parse(
    await readFile(path.join(repoRoot, "packages/re/package.json"), "utf8"),
  );
  await writeFile(path.join(source, "package/package.json"), JSON.stringify(manifest));
  const archive = "re.tgz";
  await run("tar", ["-czf", path.join(directory, archive), "package"], source);
  await writeFile(
    path.join(directory, "release.json"),
    JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      commit: await run("git", ["rev-parse", "HEAD"]),
      dirty: true,
      archive,
      integrity: `sha512-${createHash("sha512")
        .update(await readFile(path.join(directory, archive)))
        .digest("base64")}`,
    }),
  );
  return { directory, source, archive };
};

test("dry run rejects a valid archive whose contents changed after verification", async (t) => {
  const { directory, source, archive } = await releaseFixture(t);
  const manifest = await readFile(path.join(repoRoot, "packages/re/package.json"));
  await writeFile(path.join(source, "package/package.json"), manifest);
  await writeFile(path.join(source, "package/unverified.txt"), "not part of the checked release");
  await run("tar", ["-czf", path.join(directory, archive), "package"], source);
  await assert.rejects(
    exec(process.execPath, ["scripts/publish-library.mjs", "--dry-run", directory], {
      cwd: repoRoot,
    }),
    (error) => {
      assert.match(error.stderr, /Archive integrity mismatch/);
      return true;
    },
  );
});

test("real publishing rejects artifacts built from uncommitted source before contacting the registry", async (t) => {
  const { directory } = await releaseFixture(t);
  await assert.rejects(
    exec(process.execPath, ["scripts/publish-library.mjs", "--publish", directory], {
      cwd: repoRoot,
    }),
    (error) => {
      assert.match(error.stderr, /Rebuild release artifacts from a committed, clean checkout/);
      return true;
    },
  );
});
