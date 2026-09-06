import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { checkPackages } from "./check-packages.mjs";
import { libraries, packLibraries, repoRoot, run } from "./pack-libraries.mjs";

const directory = path.join(repoRoot, "dist/library-release");
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const archives = await packLibraries(directory);
await checkPackages(archives);
const packages = [];
for (const library of libraries) {
  const name = `@simbyotic/re-${library}`;
  const archive = archives[name];
  const manifest = JSON.parse(await run("tar", ["-xOf", archive, "package/package.json"]));
  assert.equal(manifest.name, name);
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.publishConfig.access, "public");
  assert.equal(manifest.publishConfig.registry, "https://registry.npmjs.org/");
  const changelog = await readFile(
    path.join(repoRoot, "packages", library, "CHANGELOG.md"),
    "utf8",
  );
  assert.ok(changelog.includes(`## ${manifest.version}\n`), `Missing release notes for ${name}`);
  packages.push({
    name,
    version: manifest.version,
    archive: path.basename(archive),
    integrity: `sha512-${createHash("sha512")
      .update(await readFile(archive))
      .digest("base64")}`,
  });
}
assert.equal(
  new Set(packages.map((entry) => entry.version)).size,
  1,
  "Library versions must match",
);
const release = {
  version: packages[0].version,
  commit: await run("git", ["rev-parse", "HEAD"]),
  dirty: (await run("git", ["status", "--porcelain"])) !== "",
  packages,
};
if (process.env.GITHUB_REF?.startsWith("refs/tags/")) {
  assert.equal(
    process.env.GITHUB_REF,
    `refs/tags/libraries-v${release.version}`,
    "Release tag must match package versions",
  );
}
await writeFile(path.join(directory, "release.json"), `${JSON.stringify(release, null, 2)}\n`);
console.log(`Verified release ${release.version} is ready in ${directory}.`);
