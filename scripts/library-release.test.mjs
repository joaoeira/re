import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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

test("preparing a library release preserves all frozen app pins and app versions", async (t) => {
  const directory = await temporary(t);
  for (const file of [
    "package.json",
    "bun.lock",
    ".changeset/config.json",
    "scripts/pack-library.mjs",
    "scripts/prepare-library-release.mjs",
    "packages/re/package.json",
    "apps/overlay/package.json",
  ]) {
    const target = path.join(directory, file);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(repoRoot, file), target);
  }
  await cp(path.join(repoRoot, "vendor"), path.join(directory, "vendor"), { recursive: true });
  await cp(path.join(repoRoot, "patches"), path.join(directory, "patches"), { recursive: true });
  // Stable release behavior must remain testable when the working package is a prerelease.
  const original = JSON.parse(
    await readFile(path.join(directory, "packages/re/package.json"), "utf8"),
  );
  original.version = "0.2.0";
  await writeFile(path.join(directory, "packages/re/package.json"), JSON.stringify(original));
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
  const expected = "0.2.1";
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
  for (const app of ["overlay"]) {
    const consumer = JSON.parse(
      await readFile(path.join(directory, "apps", app, "package.json"), "utf8"),
    );
    const before = JSON.parse(
      await readFile(path.join(repoRoot, "apps", app, "package.json"), "utf8"),
    );
    assert.equal(consumer.dependencies[manifest.name], before.dependencies[manifest.name]);
    assert.equal(consumer.version, before.version);
  }
  // A subsequent frozen install must accept the lockfile produced by preparation.
  await run(
    "bun",
    ["install", "--lockfile-only", "--frozen-lockfile", "--ignore-scripts"],
    directory,
  );
});

const releaseFixture = async (t, version = "0.2.1") => {
  const directory = await temporary(t);
  for (const file of [
    "scripts/publish-library.mjs",
    "scripts/pack-library.mjs",
    "packages/re/package.json",
  ]) {
    const target = path.join(directory, file);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(repoRoot, file), target);
  }
  const source = path.join(directory, "source");
  await mkdir(path.join(source, "package"), { recursive: true });
  const manifest = JSON.parse(
    await readFile(path.join(repoRoot, "packages/re/package.json"), "utf8"),
  );
  manifest.version = version;
  await writeFile(path.join(directory, "packages/re/package.json"), JSON.stringify(manifest));
  await run("git", ["init", "--initial-branch=master"], directory);
  await run("git", ["add", "scripts", "packages"], directory);
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
  await writeFile(path.join(source, "package/package.json"), JSON.stringify(manifest));
  const archive = "re.tgz";
  await run("tar", ["-czf", path.join(directory, archive), "package"], source);
  await writeFile(
    path.join(directory, "release.json"),
    JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      commit: await run("git", ["rev-parse", "HEAD"], directory),
      dirty: true,
      archive,
      integrity: `sha512-${createHash("sha512")
        .update(await readFile(path.join(directory, archive)))
        .digest("base64")}`,
    }),
  );
  // A stub makes accidental npm invocation observable without contacting a registry.
  const bin = path.join(directory, "bin");
  await mkdir(bin);
  const npmLog = path.join(directory, "npm-called");
  await writeFile(
    path.join(bin, "npm"),
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$RE_TEST_NPM_LOG"\nexit 97\n',
  );
  await chmod(path.join(bin, "npm"), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    RE_TEST_NPM_LOG: npmLog,
  };
  return { directory, source, archive, npmLog, env };
};

test("dry run rejects a valid archive whose contents changed after verification", async (t) => {
  const { directory, source, archive, npmLog, env } = await releaseFixture(t);
  await writeFile(path.join(source, "package/unverified.txt"), "not part of the checked release");
  await run("tar", ["-czf", path.join(directory, archive), "package"], source);
  await assert.rejects(
    exec(process.execPath, ["scripts/publish-library.mjs", "--dry-run", directory], {
      cwd: directory,
      env,
    }),
    (error) => {
      assert.match(error.stderr, /Archive integrity mismatch/);
      return true;
    },
  );
  await assert.rejects(readFile(npmLog), { code: "ENOENT" });
});

test("real publishing rejects artifacts built from uncommitted source before contacting the registry", async (t) => {
  const { directory, npmLog, env } = await releaseFixture(t);
  await assert.rejects(
    exec(process.execPath, ["scripts/publish-library.mjs", "--publish", directory], {
      cwd: directory,
      env,
    }),
    (error) => {
      assert.match(error.stderr, /Rebuild release artifacts from a committed, clean checkout/);
      return true;
    },
  );
  await assert.rejects(readFile(npmLog), { code: "ENOENT" });
});

test("local prereleases refuse the unsupported publishing route before invoking npm", async (t) => {
  const { directory, npmLog, env } = await releaseFixture(t, "0.3.0-rc.0");
  for (const mode of ["--dry-run", "--publish"]) {
    await assert.rejects(
      exec(process.execPath, ["scripts/publish-library.mjs", mode, directory], {
        cwd: directory,
        env,
      }),
      (error) => {
        assert.match(error.stderr, /Use a stable semantic version/);
        return true;
      },
    );
  }
  await assert.rejects(readFile(npmLog), { code: "ENOENT" });
});
