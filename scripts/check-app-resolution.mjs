import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFrozenLibrary, verifyFrozenApp } from "./frozen-library.mjs";
import { repoRoot } from "./pack-library.mjs";

export const checkAppResolution = async () => {
  const frozen = await readFrozenLibrary();
  for (const app of ["overlay"]) {
    const result = await verifyFrozenApp(path.join(repoRoot, "apps", app), frozen);
    console.log(
      `${result.app}: re ${result.library}, Effect ${result.effect} (${result.effectEntry})`,
    );
  }
  const libraryManifest = path.join(repoRoot, "packages/re/package.json");
  const library = JSON.parse(await readFile(libraryManifest, "utf8"));
  const require = createRequire(libraryManifest);
  const effect = JSON.parse(await readFile(require.resolve("effect/package.json"), "utf8"));
  assert.equal(
    effect.version,
    library.devDependencies.effect,
    "Workspace Effect does not match its exact declared version",
  );
  console.log(
    `Workspace re ${library.version}: Effect ${effect.version} (${await realpath(require.resolve("effect"))})`,
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkAppResolution();
}
