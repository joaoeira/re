import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectLibraryArchive, packageDirectory, repoRoot, run } from "./pack-library.mjs";

const archiveFixture = async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "re-package-check-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "package");
  await mkdir(root);
  const manifest = JSON.parse(await readFile(path.join(packageDirectory, "package.json"), "utf8"));
  const files = ["package/package.json", "package/README.md"];
  await writeFile(path.join(root, "README.md"), "Fixture package\n");
  for (const name of ["core", "item-types", "scheduler", "workspace", "study"]) {
    await mkdir(path.join(root, "dist", name), { recursive: true });
    await mkdir(path.join(root, "src", name), { recursive: true });
    for (const entry of [
      `src/${name}/index.ts`,
      `dist/${name}/index.js`,
      `dist/${name}/index.d.ts`,
    ]) {
      await writeFile(path.join(root, entry), "export {};\n");
      files.push(`package/${entry}`);
    }
    await writeFile(
      path.join(root, "dist", name, "index.d.ts.map"),
      JSON.stringify({
        version: 3,
        file: "index.d.ts",
        sources: [`../../src/${name}/index.ts`],
        names: [],
        mappings: "",
      }),
    );
    files.push(`package/dist/${name}/index.d.ts.map`);
  }
  const archive = path.join(directory, "fixture.tgz");
  const pack = async () => {
    await writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
    await run("tar", ["-czf", archive, ...files], directory);
    return archive;
  };
  // Every malformed fixture starts from an archive the production inspector accepts.
  await inspectLibraryArchive(await pack());
  return { root, manifest, pack };
};

test("an archive cannot silently drop the study entry point", async (t) => {
  const { manifest, pack } = await archiveFixture(t);
  delete manifest.exports["./study"];
  await assert.rejects(inspectLibraryArchive(await pack()), /five public entry points/);
});

test("removed platform peers are rejected even when every export exists", async (t) => {
  const { manifest, pack } = await archiveFixture(t);
  manifest.peerDependencies["@effect/platform"] = "^0.94.5";
  await assert.rejects(inspectLibraryArchive(await pack()), /removed v3 platform peerDependencies/);
});

test("delivered source, JavaScript, and declarations cannot import the old platform", async (t) => {
  const { root, pack } = await archiveFixture(t);
  for (const entry of [
    "src/workspace/index.ts",
    "dist/workspace/index.js",
    "dist/workspace/index.d.ts",
  ]) {
    const target = path.join(root, entry);
    await writeFile(target, 'export * from "@effect/platform/FileSystem";\n');
    await assert.rejects(inspectLibraryArchive(await pack()), /Removed v3 platform import/);
    await writeFile(target, "export {};\n");
  }
  await inspectLibraryArchive(await pack());
});

test("unsupported consumer Effect versions fail before building or installing", async () => {
  await assert.rejects(
    run(process.execPath, ["scripts/check-packages.mjs"], repoRoot, {
      ...process.env,
      RE_CONSUMER_EFFECT_VERSION: "^4.0.0-rc.112",
    }),
    /Unsupported consumer Effect version/,
  );
});
