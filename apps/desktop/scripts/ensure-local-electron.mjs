#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "../..");

const localNodeModules = path.join(desktopDir, "node_modules");
const modulesToLink = ["electron", "react", "react-dom"];
const viteCacheTargets = [
  path.join(localNodeModules, ".vite", "deps"),
  path.join(localNodeModules, ".vite", "deps_temp"),
  path.join(localNodeModules, ".vite-temp"),
];

const pathExists = async (target) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const ensureLinkedModule = async (moduleName) => {
  const rootModuleDir = path.join(repoRoot, "node_modules", moduleName);
  const localModuleDir = path.join(localNodeModules, moduleName);

  if (!(await pathExists(rootModuleDir))) {
    throw new Error(
      `${moduleName} is missing at ${rootModuleDir}. Run 'bun install' at repo root first.`,
    );
  }

  if (await pathExists(localModuleDir)) {
    const stats = await fs.lstat(localModuleDir);

    if (stats.isSymbolicLink()) {
      const currentTarget = await fs.readlink(localModuleDir);
      const resolvedTarget = path.resolve(path.dirname(localModuleDir), currentTarget);
      if (resolvedTarget === rootModuleDir) {
        return;
      }
    }

    await fs.rm(localModuleDir, { recursive: true, force: true });
  }

  await fs.symlink(rootModuleDir, localModuleDir, "junction");
  console.log(`[desktop] linked ${moduleName} -> ${localModuleDir}`);
};

const clearViteCache = async () => {
  for (const target of viteCacheTargets) {
    await fs.rm(target, { recursive: true, force: true });
  }
};

const main = async () => {
  await fs.mkdir(localNodeModules, { recursive: true });
  await clearViteCache();
  for (const moduleName of modulesToLink) {
    await ensureLinkedModule(moduleName);
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[desktop] failed to link electron: ${message}`);
  process.exitCode = 1;
});
