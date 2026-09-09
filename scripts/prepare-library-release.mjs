import { readFile } from "node:fs/promises";
import path from "node:path";

import { packageDirectory, run } from "./pack-library.mjs";

console.log(await run("bun", ["x", "--no-install", "changeset", "version"]));
const release = JSON.parse(await readFile(path.join(packageDirectory, "package.json"), "utf8"));
console.log(await run("bun", ["install", "--lockfile-only", "--ignore-scripts"]));
console.log(
  `Prepared library release ${release.version}. Review and commit the version, changelog, and lockfile changes.`,
);
