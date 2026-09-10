import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageName, repoRoot } from "./pack-library.mjs";

const readManifest = async (filename) => JSON.parse(await readFile(filename, "utf8"));

export const checkAppResolution = async () => {
  const libraryManifest = path.join(repoRoot, "packages/re/package.json");
  const library = await readManifest(libraryManifest);
  const libraryRequire = createRequire(libraryManifest);
  const expectedEffect = library.peerDependencies.effect;
  assert.match(
    expectedEffect,
    /^4\.\d+\.\d+(?:-[\w.-]+)?$/,
    "The library must pin Effect v4 exactly",
  );
  assert.equal(library.devDependencies.effect, expectedEffect);

  const appManifest = path.join(repoRoot, "apps/overlay/package.json");
  const app = await readManifest(appManifest);
  const appRequire = createRequire(appManifest);
  assert.equal(
    app.dependencies[packageName],
    "workspace:*",
    "Overlay must consume the workspace library",
  );
  for (const name of ["effect", "@effect/platform-node"]) {
    assert.equal(
      app.dependencies[name],
      expectedEffect,
      `Overlay must pin ${name} to ${expectedEffect}`,
    );
  }
  assert.equal(
    app.dependencies["@effect/platform"],
    undefined,
    "Remove the v3 platform dependency",
  );

  const entries = new Map();
  for (const name of ["core", "item-types", "scheduler", "workspace", "study"]) {
    const specifier = `${packageName}/${name}`;
    const entry = await realpath(appRequire.resolve(specifier));
    assert.equal(
      entry,
      await realpath(libraryRequire.resolve(specifier)),
      `Overlay resolved ${specifier} outside the workspace library`,
    );
    entries.set(name, entry);
  }

  const adapterManifest = appRequire.resolve("@effect/platform-node/package.json");
  const adapterRequire = createRequire(adapterManifest);
  const sharedManifest = adapterRequire.resolve("@effect/platform-node-shared/package.json");
  const sharedRequire = createRequire(sharedManifest);
  for (const filename of [adapterManifest, sharedManifest]) {
    const adapter = await readManifest(filename);
    assert.equal(
      adapter.version,
      expectedEffect,
      `${adapter.name} must match the library's Effect version`,
    );
  }

  const effectEntry = await realpath(libraryRequire.resolve("effect"));
  for (const [name, require] of [
    ["Overlay", appRequire],
    ["Library", libraryRequire],
    ["Node adapter", adapterRequire],
    ["Shared Node adapter", sharedRequire],
  ]) {
    const effect = await readManifest(require.resolve("effect/package.json"));
    assert.equal(effect.version, expectedEffect, `${name} resolved the wrong Effect version`);
    assert.equal(
      await realpath(require.resolve("effect")),
      effectEntry,
      `${name} resolved a different Effect installation`,
    );
  }

  // Import the public compiled exports using the same runtime the application resolves.
  for (const entry of entries.values()) await import(pathToFileURL(entry).href);
  const { Effect } = await import(pathToFileURL(effectEntry).href);
  const { parseFile, serializeFile } = await import(pathToFileURL(entries.get("core")).href);
  const markdown = "<!--@ overlaycheck 0 0 0 0-->\nQuestion\n---\nAnswer";
  assert.equal(serializeFile(await Effect.runPromise(parseFile(markdown))), markdown);
  console.log(
    `${app.name}: workspace re ${library.version}, one shared Effect ${expectedEffect} (${effectEntry}); all five exports passed.`,
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkAppResolution();
}
