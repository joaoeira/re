import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { libraries, repoRoot, run } from "./pack-libraries.mjs";

const [mode, location, ...extra] = process.argv.slice(2);
assert.ok(
  ["--dry-run", "--publish"].includes(mode) && extra.length === 0,
  "Usage: node scripts/publish-libraries.mjs <--dry-run|--publish> [artifact-directory]",
);
const directory = path.resolve(location ?? path.join(repoRoot, "dist/library-release"));
const registry = "https://registry.npmjs.org/";
const release = JSON.parse(await readFile(path.join(directory, "release.json"), "utf8"));
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
assert.equal(release.packages.length, libraries.length, "Expected the complete library release");
const packages = [];
// Validate the whole set before any network write, including retries after a partial publish.
for (const [index, library] of libraries.entries()) {
  const entry = release.packages[index];
  const current = JSON.parse(
    await readFile(path.join(repoRoot, "packages", library, "package.json"), "utf8"),
  );
  assert.equal(entry.name, current.name, "Unexpected package or dependency order");
  assert.equal(entry.version, release.version);
  assert.equal(
    current.version,
    release.version,
    "Artifacts do not match the current package version",
  );
  assert.equal(
    path.basename(entry.archive),
    entry.archive,
    "Archive must be inside the release directory",
  );
  assert.ok(entry.archive.endsWith(".tgz"));
  const archive = path.join(directory, entry.archive);
  const integrity = `sha512-${createHash("sha512")
    .update(await readFile(archive))
    .digest("base64")}`;
  assert.equal(integrity, entry.integrity, `Archive integrity mismatch: ${entry.name}`);
  const manifest = JSON.parse(await run("tar", ["-xOf", archive, "package/package.json"]));
  assert.equal(manifest.name, entry.name);
  assert.equal(manifest.version, entry.version);
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.publishConfig.registry, registry);
  assert.equal(manifest.publishConfig.access, "public");
  packages.push({ ...entry, archive });
}
if (mode === "--publish") {
  assert.equal(release.dirty, false, "Rebuild release artifacts from a committed, clean checkout");
  assert.equal(
    await run("git", ["status", "--porcelain"]),
    "",
    "Publishing requires a clean checkout",
  );
  if (process.env.GITHUB_ACTIONS === "true") {
    assert.equal(process.env.GITHUB_REF, `refs/tags/libraries-v${release.version}`);
    assert.equal(process.env.GITHUB_REPOSITORY, "joaoeira/re");
  }
}
const pending = [];
for (const entry of packages) {
  if (mode === "--dry-run") {
    console.log(
      await run("npm", [
        "publish",
        entry.archive,
        "--dry-run",
        "--ignore-scripts",
        "--access",
        "public",
        "--registry",
        registry,
      ]),
    );
    continue;
  }
  const response = await fetch(`${registry}${encodeURIComponent(entry.name)}/${entry.version}`);
  if (response.status === 404) {
    pending.push(entry);
  } else {
    assert.equal(response.status, 200, `Registry lookup failed for ${entry.name}`);
    const published = await response.json();
    assert.equal(
      published.dist.integrity,
      entry.integrity,
      `Published version differs from the verified archive: ${entry.name}`,
    );
    console.log(`Already published with matching integrity: ${entry.name}@${entry.version}`);
  }
}
for (const entry of pending) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      "npm",
      [
        "publish",
        entry.archive,
        "--ignore-scripts",
        "--access",
        "public",
        "--tag",
        "latest",
        "--registry",
        registry,
      ],
      { cwd: repoRoot, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`npm publish failed for ${entry.name} (${code})`)),
    );
  });
}
console.log(
  mode === "--dry-run"
    ? "Publish dry run passed; nothing was uploaded."
    : `Published library release ${release.version}.`,
);
