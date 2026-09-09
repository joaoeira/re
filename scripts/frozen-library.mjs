import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { packageName, repoRoot, run } from "./pack-library.mjs";

export const frozenDirectory = path.join(repoRoot, "vendor/re-effect3");
export const libraryExports = ["core", "item-types", "scheduler", "workspace", "study"];
const integrity = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

const verifiedFile = async (directory, filename, expectedIntegrity) => {
  assert.equal(
    path.basename(filename),
    filename,
    "Frozen files must stay in their vendor directory",
  );
  const filenamePath = await realpath(path.join(directory, filename));
  assert.equal(
    path.dirname(filenamePath),
    await realpath(directory),
    "Frozen file escapes vendor directory",
  );
  assert.equal(
    integrity(await readFile(filenamePath)),
    expectedIntegrity,
    `Frozen integrity mismatch: ${filename}`,
  );
  return filenamePath;
};

export const readFrozenLibrary = async (directory = frozenDirectory) => {
  const metadata = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  assert.equal(metadata.name, packageName);
  assert.match(metadata.version, /^\d+\.\d+\.\d+-effect3\.\d+$/);
  assert.match(metadata.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(metadata.effect, "3.19.18");
  assert.equal(metadata.platform, "0.94.5");
  assert.equal(metadata.sourceClean, metadata.sourcePatch === undefined);
  if (metadata.sourcePatch) {
    await verifiedFile(directory, metadata.sourcePatch.file, metadata.sourcePatch.integrity);
  }
  const archive = await verifiedFile(directory, metadata.archive, metadata.integrity);
  const entries = (await run("tar", ["-tzf", archive])).split("\n");
  for (const entry of entries) {
    assert.ok(
      entry.startsWith("package/") && !entry.split("/").includes(".."),
      `Invalid archive path: ${entry}`,
    );
  }
  const manifest = JSON.parse(await run("tar", ["-xOf", archive, "package/package.json"]));
  assert.equal(manifest.name, packageName);
  assert.equal(manifest.version, metadata.version);
  assert.equal(manifest.peerDependencies.effect, "^3.19.18");
  assert.equal(manifest.peerDependencies["@effect/platform"], "^0.94.5");
  assert.deepEqual(
    Object.keys(manifest.exports).sort(),
    libraryExports.map((name) => `./${name}`).sort(),
  );
  for (const target of Object.values(manifest.exports).flatMap(Object.values)) {
    assert.ok(
      entries.includes(`package/${target.replace(/^\.\//, "")}`),
      `Missing frozen export: ${target}`,
    );
  }
  for (const declaration of entries.filter((entry) => entry.endsWith(".d.ts"))) {
    assert.ok(
      entries.includes(`${declaration}.map`),
      `Missing frozen declaration map: ${declaration}`,
    );
    const map = JSON.parse(await run("tar", ["-xOf", archive, `${declaration}.map`]));
    assert.ok(map.sources.length > 0, `Empty frozen declaration map: ${declaration}`);
    for (const source of map.sources) {
      assert.ok(
        entries.includes(
          path.posix.join(path.posix.dirname(declaration), map.sourceRoot ?? "", source),
        ),
        `Missing frozen declaration source: ${source}`,
      );
    }
  }
  return {
    metadata,
    archive,
    directory,
    dependency: `file:../../vendor/re-effect3/${metadata.archive}`,
  };
};

export const verifyFrozenApp = async (
  appDirectory,
  frozen,
  workspaceDirectory = path.join(repoRoot, "packages/re"),
) => {
  const appManifest = JSON.parse(await readFile(path.join(appDirectory, "package.json"), "utf8"));
  assert.equal(
    appManifest.dependencies[packageName],
    frozen.dependency,
    "App must pin the approved frozen library",
  );
  const appRequire = createRequire(path.join(appDirectory, "package.json"));
  const coreEntry = await realpath(appRequire.resolve(`${packageName}/core`));
  const installedDirectory = path.resolve(path.dirname(coreEntry), "../..");
  assert.notEqual(
    installedDirectory,
    await realpath(workspaceDirectory),
    "App resolved the live workspace library",
  );
  const installed = JSON.parse(
    await readFile(path.join(installedDirectory, "package.json"), "utf8"),
  );
  assert.equal(installed.name, packageName);
  assert.equal(
    installed.version,
    frozen.metadata.version,
    "App resolved an unexpected library version",
  );
  assert.equal(installed.peerDependencies.effect, "^3.19.18");
  for (const name of libraryExports) {
    const entry = await realpath(appRequire.resolve(`${packageName}/${name}`));
    assert.ok(
      entry.startsWith(`${installedDirectory}${path.sep}`),
      `Export escaped frozen package: ${name}`,
    );
    await import(pathToFileURL(entry).href);
  }
  const libraryRequire = createRequire(coreEntry);
  const effectEntry = await realpath(appRequire.resolve("effect"));
  assert.equal(
    effectEntry,
    await realpath(libraryRequire.resolve("effect")),
    "App and frozen library have different Effect installations",
  );
  const effect = JSON.parse(await readFile(appRequire.resolve("effect/package.json"), "utf8"));
  assert.equal(effect.version, frozen.metadata.effect);
  const { Effect } = await import(pathToFileURL(effectEntry).href);
  const { parseFile, serializeFile } = await import(pathToFileURL(coreEntry).href);
  const markdown = "<!--@ isolation 0 0 0 0-->\nQuestion\n---\nAnswer";
  assert.equal(serializeFile(await Effect.runPromise(parseFile(markdown))), markdown);
  return { app: appManifest.name, library: installed.version, effect: effect.version, effectEntry };
};
