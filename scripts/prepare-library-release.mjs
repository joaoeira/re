import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

import { packageDirectory, packageName, repoRoot, run } from "./pack-library.mjs";

console.log(await run("bun", ["x", "--no-install", "changeset", "version"]));
const release = JSON.parse(await readFile(path.join(packageDirectory, "package.json"), "utf8"));
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
  if (manifest.dependencies?.[packageName]) manifest.dependencies[packageName] = release.version;
  await writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(await run("bun", ["install", "--lockfile-only", "--ignore-scripts"]));
console.log(
  `Prepared library release ${release.version}. Review and commit the version, changelog, and lockfile changes.`,
);
