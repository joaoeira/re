import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const repoRoot = fileURLToPath(new URL("../", import.meta.url));
export const libraries = ["core", "item-types", "scheduler", "workspace"];

export const run = async (command, args, cwd = repoRoot, env = process.env) => {
  try {
    const { stdout } = await exec(command, args, { cwd, env, maxBuffer: 10 * 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    throw new Error(
      `${command} ${args.join(" ")} failed in ${cwd}\n${error.stdout ?? ""}${error.stderr ?? ""}`,
      { cause: error },
    );
  }
};

export const packLibraries = async (destination) => {
  await mkdir(destination, { recursive: true });
  const manifests = new Map();
  for (const library of libraries) {
    const directory = path.join(repoRoot, "packages", library);
    const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    manifests.set(manifest.name, manifest);
    // Remove stale outputs as well as incremental state before producing release artifacts.
    await rm(path.join(directory, "dist"), { recursive: true, force: true });
  }

  console.log("Building libraries from clean output directories...");
  await run(process.execPath, ["node_modules/typescript/bin/tsc", "-b", "tsconfig.build.json"]);

  const archives = {};
  for (const library of libraries) {
    const directory = path.join(repoRoot, "packages", library);
    // Bun resolves workspace:* to the package version in the archive, without editing source manifests.
    const filename = await run(
      "bun",
      ["pm", "pack", "--destination", destination, "--ignore-scripts", "--quiet"],
      directory,
    );
    const archive = path.resolve(destination, filename);
    const entries = (await run("tar", ["-tzf", archive])).split("\n");
    const manifest = JSON.parse(await run("tar", ["-xOf", archive, "package/package.json"]));
    const original = manifests.get(manifest.name);
    assert.ok(original, `Unexpected package: ${manifest.name}`);
    assert.equal(manifest.version, original.version);
    for (const entry of entries) {
      assert.match(
        entry,
        /^package\/(?:package\.json|README\.md|dist\/.+\.(?:js|d\.ts(?:\.map)?)|src\/.+\.ts)$/,
        `Unexpected file in ${manifest.name}: ${entry}`,
      );
      if (entry.endsWith(".js") || entry.endsWith(".ts")) {
        assert.doesNotMatch(
          await run("tar", ["-xOf", archive, entry]),
          /@effect\/schema/,
          `Legacy Schema reference in ${entry}`,
        );
      }
    }
    // Declaration navigation must resolve inside the delivered package, including nested modules.
    for (const declaration of entries.filter((entry) => entry.endsWith(".d.ts"))) {
      const mapPath = `${declaration}.map`;
      assert.ok(entries.includes(mapPath), `Missing declaration map: ${mapPath}`);
      const map = JSON.parse(await run("tar", ["-xOf", archive, mapPath]));
      assert.ok(map.sources.length > 0, `Empty declaration map: ${mapPath}`);
      for (const source of map.sources) {
        const sourcePath = path.posix.join(
          path.posix.dirname(mapPath),
          map.sourceRoot ?? "",
          source,
        );
        assert.ok(entries.includes(sourcePath), `Missing declaration source: ${sourcePath}`);
      }
    }
    for (const entry of [manifest.main, manifest.types, ...Object.values(manifest.exports["."])]) {
      assert.equal(typeof entry, "string");
      assert.ok(entries.includes(`package/${entry.replace(/^\.\//, "")}`), `Missing ${entry}`);
    }
    assert.ok(entries.includes("package/README.md"));
    for (const field of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
      "devDependencies",
    ]) {
      for (const [name, version] of Object.entries(manifest[field] ?? {})) {
        assert.notEqual(name, "@effect/schema", `${manifest.name}: legacy Schema ${field}`);
        assert.doesNotMatch(version, /^(?:workspace|file|link):/, `${manifest.name}: ${name}`);
        if (manifests.has(name)) assert.equal(version, manifests.get(name).version);
      }
    }
    archives[manifest.name] = archive;
    console.log(
      `Packed and inspected ${manifest.name}@${manifest.version} (${entries.length} files)`,
    );
  }
  return archives;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packLibraries(path.resolve(repoRoot, "dist/packages"));
  console.log("Archives are available in dist/packages/.");
}
