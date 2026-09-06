import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { libraries, repoRoot, run } from "./pack-libraries.mjs";

const exec = promisify(execFile);
const temporary = async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "re-release-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

test("preparing one library change versions the whole set, writes changelogs, and updates app pins without versioning apps", async (t) => {
  const directory = await temporary(t);
  for (const file of [
    "package.json",
    "bun.lock",
    ".changeset/config.json",
    "scripts/pack-libraries.mjs",
    "scripts/prepare-library-release.mjs",
    ...libraries.map((name) => `packages/${name}/package.json`),
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
    await readFile(path.join(directory, "packages/core/package.json"), "utf8"),
  );
  const [major, minor, patch] = original.version.split(".").map(Number);
  const expected = `${major}.${minor}.${patch + 1}`;
  await writeFile(
    path.join(directory, ".changeset/test-change.md"),
    `---\n"${original.name}": patch\n---\n\nPreserve card data when updating a deck.\n`,
  );
  await run(process.execPath, ["scripts/prepare-library-release.mjs"], directory);
  for (const library of libraries) {
    const manifest = JSON.parse(
      await readFile(path.join(directory, "packages", library, "package.json"), "utf8"),
    );
    assert.equal(manifest.version, expected);
    assert.ok(
      (await readFile(path.join(directory, "packages", library, "CHANGELOG.md"), "utf8")).includes(
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
  const packages = [];
  for (const library of libraries) {
    const manifest = JSON.parse(
      await readFile(path.join(repoRoot, "packages", library, "package.json"), "utf8"),
    );
    await writeFile(path.join(source, "package/package.json"), JSON.stringify(manifest));
    const archive = `${library}.tgz`;
    await run("tar", ["-czf", path.join(directory, archive), "package"], source);
    packages.push({
      name: manifest.name,
      version: manifest.version,
      archive,
      integrity: `sha512-${createHash("sha512")
        .update(await readFile(path.join(directory, archive)))
        .digest("base64")}`,
    });
  }
  await writeFile(
    path.join(directory, "release.json"),
    JSON.stringify({
      version: packages[0].version,
      commit: await run("git", ["rev-parse", "HEAD"]),
      dirty: true,
      packages,
    }),
  );
  return { directory, source, packages };
};

test("dry run rejects a valid archive whose contents changed after verification", async (t) => {
  const { directory, source, packages } = await releaseFixture(t);
  const manifest = await readFile(path.join(repoRoot, "packages/core/package.json"));
  await writeFile(path.join(source, "package/package.json"), manifest);
  await writeFile(path.join(source, "package/unverified.txt"), "not part of the checked release");
  await run("tar", ["-czf", path.join(directory, packages[0].archive), "package"], source);
  await assert.rejects(
    exec(process.execPath, ["scripts/publish-libraries.mjs", "--dry-run", directory], {
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
    exec(process.execPath, ["scripts/publish-libraries.mjs", "--publish", directory], {
      cwd: repoRoot,
    }),
    (error) => {
      assert.match(error.stderr, /Rebuild release artifacts from a committed, clean checkout/);
      return true;
    },
  );
});
