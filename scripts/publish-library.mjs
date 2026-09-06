import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { packageDirectory, packageName, repoRoot, run } from "./pack-library.mjs";

const [mode, location, ...extra] = process.argv.slice(2);
assert.ok(
  ["--dry-run", "--publish"].includes(mode) && extra.length === 0,
  "Usage: node scripts/publish-library.mjs <--dry-run|--publish> [artifact-directory]",
);
const directory = path.resolve(location ?? path.join(repoRoot, "dist/library-release"));
const registry = "https://registry.npmjs.org/";
const release = JSON.parse(await readFile(path.join(directory, "release.json"), "utf8"));
const current = JSON.parse(await readFile(path.join(packageDirectory, "package.json"), "utf8"));
assert.match(
  release.version,
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
  "Use a stable semantic version",
);
assert.equal(
  release.commit,
  await run("git", ["rev-parse", "HEAD"]),
  "Artifacts belong to another commit",
);
assert.equal(release.name, packageName);
assert.equal(current.name, packageName);
assert.equal(
  current.version,
  release.version,
  "Artifacts do not match the current package version",
);
assert.equal(
  path.basename(release.archive),
  release.archive,
  "Archive must be inside the release directory",
);
assert.ok(release.archive.endsWith(".tgz"));
const archive = path.join(directory, release.archive);
const integrity = `sha512-${createHash("sha512")
  .update(await readFile(archive))
  .digest("base64")}`;
assert.equal(integrity, release.integrity, "Archive integrity mismatch");
const manifest = JSON.parse(await run("tar", ["-xOf", archive, "package/package.json"]));
assert.equal(manifest.name, packageName);
assert.equal(manifest.version, release.version);
assert.equal(manifest.private, undefined);
assert.equal(manifest.publishConfig.registry, registry);
assert.equal(manifest.publishConfig.access, "public");
if (mode === "--publish") {
  assert.equal(release.dirty, false, "Rebuild release artifacts from a committed, clean checkout");
  assert.equal(
    await run("git", ["status", "--porcelain"]),
    "",
    "Publishing requires a clean checkout",
  );
  if (process.env.GITHUB_ACTIONS === "true") {
    assert.equal(process.env.GITHUB_REF, `refs/tags/re-v${release.version}`);
    assert.equal(process.env.GITHUB_REPOSITORY, "joaoeira/re");
  }
  const response = await fetch(`${registry}${encodeURIComponent(packageName)}/${release.version}`);
  if (response.status !== 404) {
    assert.equal(response.status, 200, "Registry lookup failed");
    const published = await response.json();
    assert.equal(
      published.dist.integrity,
      release.integrity,
      "Published version differs from the verified archive",
    );
    console.log(`Already published with matching integrity: ${packageName}@${release.version}`);
    process.exit(0);
  }
}
const args = [
  "publish",
  archive,
  "--ignore-scripts",
  "--access",
  "public",
  "--tag",
  "latest",
  "--registry",
  registry,
];
if (mode === "--dry-run") {
  console.log(await run("npm", [...args, "--dry-run"]));
  console.log("Publish dry run passed; nothing was uploaded.");
} else {
  await new Promise((resolve, reject) => {
    const child = spawn("npm", args, { cwd: repoRoot, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`npm publish failed (${code})`)),
    );
  });
  console.log(`Published ${packageName}@${release.version}.`);
}
