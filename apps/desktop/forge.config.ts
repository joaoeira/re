import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXTERNAL_RUNTIME_PACKAGES = ["better-sqlite3", "pdf-parse"];

function resolvePackageDir(name: string, searchDirs: string[]): string | null {
  for (const dir of searchDirs) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }
  return null;
}

function collectRuntimeDependencyDirs(
  name: string,
  searchDirs: string[],
  collected: Map<string, string>,
  required: boolean,
): void {
  if (collected.has(name)) return;
  const dir = resolvePackageDir(name, searchDirs);
  if (!dir) {
    if (required)
      throw new Error(
        `Cannot resolve runtime dependency "${name}" for packaging`,
      );
    return;
  }
  collected.set(name, dir);
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  );
  const nextSearchDirs = [dir, ...searchDirs];
  for (const depName of Object.keys(pkg.dependencies ?? {})) {
    collectRuntimeDependencyDirs(depName, nextSearchDirs, collected, true);
  }
  for (const depName of Object.keys(pkg.optionalDependencies ?? {})) {
    collectRuntimeDependencyDirs(depName, nextSearchDirs, collected, false);
  }
}

const config = {
  packagerConfig: {
    asar: {
      unpack: "**/*.{node,so,dylib,dll}",
    },
    appBundleId: "com.re.desktop",
    executableName: "re-desktop",
    extendInfo: {
      NSDocumentsFolderUsageDescription:
        "re Desktop reads and saves your decks in your workspace folder.",
      NSDesktopFolderUsageDescription:
        "re Desktop reads and saves your decks in your workspace folder.",
      NSDownloadsFolderUsageDescription:
        "re Desktop reads and saves your decks in your workspace folder.",
    },
    osxSign: {
      identity: "-",
      identityValidation: false,
      preAutoEntitlements: false,
      optionsForFile: () => ({ hardenedRuntime: false }),
    },
  },
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (_forgeConfig: unknown, buildPath: string) => {
      const searchRoots = [__dirname, path.join(__dirname, "..", "..")];
      const collected = new Map<string, string>();
      for (const name of EXTERNAL_RUNTIME_PACKAGES) {
        collectRuntimeDependencyDirs(name, searchRoots, collected, true);
      }
      const destNodeModules = path.join(buildPath, "node_modules");
      for (const [name, sourceDir] of collected) {
        const destDir = path.join(destNodeModules, name);
        fs.mkdirSync(path.dirname(destDir), { recursive: true });
        fs.cpSync(sourceDir, destDir, { recursive: true, dereference: true });
      }
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ["darwin"]),
    new MakerDeb({}),
    new MakerRpm({}),
    new MakerDMG({ format: "ULFO" }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/index.ts",
          config: "vite.main.config.mts",
        },
        {
          entry: "src/preload/index.ts",
          config: "vite.preload.config.mts",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.mts",
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
