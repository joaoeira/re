import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  frozenDirectory,
  prepareFrozenApp,
  readFrozenLibrary,
  verifyFrozenApp,
} from "./frozen-library.mjs";
import { packageDirectory, repoRoot, run } from "./pack-library.mjs";

const temporary = async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "re-app-isolation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

test("changed frozen bytes fail verification instead of reaching app export", async (t) => {
  const directory = await temporary(t);
  await cp(frozenDirectory, directory, { recursive: true });
  const metadata = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  await writeFile(path.join(directory, metadata.archive), "unapproved replacement");
  await assert.rejects(readFrozenLibrary(directory), /Frozen integrity mismatch/);
});

test("an app repointed at the workspace version cannot be exported as a frozen app", async (t) => {
  const directory = await temporary(t);
  const library = JSON.parse(await readFile(path.join(packageDirectory, "package.json"), "utf8"));
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      dependencies: { "@simbyotic/re": library.version },
    }),
  );
  await assert.rejects(prepareFrozenApp(directory), /App must pin the approved frozen library/);
  await assert.rejects(readFile(path.join(directory, "vendor/manifest.json")), { code: "ENOENT" });
});

test("resolution detects a live workspace link even when the app manifest has the frozen pin", async (t) => {
  const directory = await temporary(t);
  const frozen = await readFrozenLibrary();
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "wrong-resolution",
      dependencies: { "@simbyotic/re": frozen.dependency },
    }),
  );
  await mkdir(path.join(directory, "node_modules/@simbyotic"), { recursive: true });
  // A same-name v4 workspace with no generated dist must still be rejected.
  const workspace = path.join(directory, "workspace");
  await mkdir(workspace);
  await writeFile(
    path.join(workspace, "package.json"),
    JSON.stringify({
      name: "@simbyotic/re",
      version: "0.3.0-rc.0",
      exports: { "./core": "./src/core/index.js" },
      devDependencies: { effect: "4.0.0-rc.112" },
    }),
  );
  await mkdir(path.join(workspace, "src/core"), { recursive: true });
  await writeFile(path.join(workspace, "src/core/index.js"), "export {};\n");
  await symlink(workspace, path.join(directory, "node_modules/@simbyotic/re"), "dir");
  await assert.rejects(
    verifyFrozenApp(directory, frozen, workspace),
    /App resolved the live workspace library/,
  );
});

test("standalone preparation preserves verified bytes, provenance and a runnable five-export library", async (t) => {
  const directory = await temporary(t);
  const frozen = await readFrozenLibrary();
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "standalone-consumer",
      dependencies: { "@simbyotic/re": frozen.dependency },
    }),
  );
  await prepareFrozenApp(directory, frozen);
  const exported = await readFrozenLibrary(path.join(directory, "vendor"));
  assert.equal(exported.metadata.integrity, frozen.metadata.integrity);
  const installation = path.join(directory, "node_modules/@simbyotic/re");
  await mkdir(installation, { recursive: true });
  await run("tar", ["-xzf", exported.archive, "--strip-components=1", "-C", installation]);
  // Use the existing dependency installation, but the library itself must be archive bytes.
  for (const name of ["effect", "@effect", "ignore", "nanoid", "ts-fsrs"]) {
    await symlink(
      path.join(repoRoot, "node_modules", name),
      path.join(directory, "node_modules", name),
      "dir",
    );
  }
  const result = await verifyFrozenApp(directory, exported);
  assert.equal(result.library, frozen.metadata.version);
  assert.equal(result.effect, "3.19.18");
});
