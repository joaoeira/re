import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

import { libraries, repoRoot, run } from "./pack-libraries.mjs";

console.log(await run("bun", ["x", "--no-install", "changeset", "version"]));
const versions = new Map();
for (const library of libraries) {
  const manifest = JSON.parse(
    await readFile(path.join(repoRoot, "packages", library, "package.json"), "utf8"),
  );
  versions.set(manifest.name, manifest.version);
}
if (new Set(versions.values()).size !== 1)
  throw new Error("The libraries must share one release version");
// Until extraction, keep each app consuming the workspace version. This does not
// version or publish the apps themselves.
for (const app of ["desktop", "raycast"]) {
  const filename = path.join(repoRoot, "apps", app, "package.json");
  if (
    !(await access(filename).then(
      () => true,
      (error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    ))
  )
    continue;
  const manifest = JSON.parse(await readFile(filename, "utf8"));
  for (const [name, version] of versions) {
    if (manifest.dependencies?.[name]) manifest.dependencies[name] = version;
  }
  await writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(await run("bun", ["install", "--lockfile-only", "--ignore-scripts"]));
console.log(
  `Prepared library release ${[...versions.values()][0]}. Review and commit the version, changelog, and lockfile changes.`,
);
