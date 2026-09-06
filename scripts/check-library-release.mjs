import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { checkPackages } from "./check-packages.mjs";
import { packageDirectory, packageName, packLibrary, repoRoot, run } from "./pack-library.mjs";

const directory = path.join(repoRoot, "dist/library-release");
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const archive = await packLibrary(directory);
await checkPackages(archive);
const manifest = JSON.parse(await run("tar", ["-xOf", archive, "package/package.json"]));
assert.equal(manifest.name, packageName);
assert.equal(manifest.private, undefined);
assert.equal(manifest.publishConfig.access, "public");
assert.equal(manifest.publishConfig.registry, "https://registry.npmjs.org/");
const changelog = await readFile(path.join(packageDirectory, "CHANGELOG.md"), "utf8");
assert.ok(changelog.includes(`## ${manifest.version}\n`), "Missing release notes");
const release = {
  name: packageName,
  version: manifest.version,
  commit: await run("git", ["rev-parse", "HEAD"]),
  dirty: (await run("git", ["status", "--porcelain"])) !== "",
  archive: path.basename(archive),
  integrity: `sha512-${createHash("sha512")
    .update(await readFile(archive))
    .digest("base64")}`,
};
if (process.env.GITHUB_REF?.startsWith("refs/tags/")) {
  assert.equal(
    process.env.GITHUB_REF,
    `refs/tags/re-v${release.version}`,
    "Release tag must match the package version",
  );
}
await writeFile(path.join(directory, "release.json"), `${JSON.stringify(release, null, 2)}\n`);
console.log(`Verified ${packageName}@${release.version} is ready in ${directory}.`);
