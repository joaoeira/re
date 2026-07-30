#!/usr/bin/env node

import { execFile as execFileCallback, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const desktopDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopDir, "../..");
const forgeCli = path.join(
  repoRoot,
  "node_modules",
  "@electron-forge",
  "cli",
  "dist",
  "electron-forge.js",
);

const SUPPORTED_NODE_MINIMUM = 22;
const SUPPORTED_NODE_MAXIMUM_EXCLUSIVE = 25;
const FORGE_COMMANDS = new Set(["make", "package"]);

export const parseNodeVersion = (version) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return match.slice(1, 4).map(Number);
};

export const isSupportedNodeVersion = (version) => {
  const parsed = parseNodeVersion(version);
  return (
    parsed !== null &&
    parsed[0] >= SUPPORTED_NODE_MINIMUM &&
    parsed[0] < SUPPORTED_NODE_MAXIMUM_EXCLUSIVE
  );
};

const compareVersionsDescending = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left.version[index] !== right.version[index]) {
      return right.version[index] - left.version[index];
    }
  }
  return 0;
};

const pathExists = async (target) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

export const runProcess = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: desktopDir,
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${path.basename(command)} failed${
            signal ? ` with signal ${signal}` : ` with exit code ${code}`
          }`,
        ),
      );
    });
  });

const nodeCandidates = async () => {
  const candidates = new Set([process.execPath]);
  const addCandidate = (candidate) => {
    if (candidate) candidates.add(path.resolve(candidate));
  };

  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (directory) addCandidate(path.join(directory, "node"));
  }

  addCandidate(process.env.NVM_BIN ? path.join(process.env.NVM_BIN, "node") : null);
  addCandidate("/opt/homebrew/opt/node@24/bin/node");
  addCandidate("/opt/homebrew/opt/node@23/bin/node");
  addCandidate("/opt/homebrew/opt/node@22/bin/node");
  addCandidate("/usr/local/opt/node@24/bin/node");
  addCandidate("/usr/local/opt/node@23/bin/node");
  addCandidate("/usr/local/opt/node@22/bin/node");

  const nvmVersionsDir = path.join(os.homedir(), ".nvm", "versions", "node");
  try {
    for (const entry of await fs.readdir(nvmVersionsDir)) {
      addCandidate(path.join(nvmVersionsDir, entry, "bin", "node"));
    }
  } catch {
    // NVM is optional.
  }

  return [...candidates];
};

export const findCompatibleNode = async () => {
  const compatible = [];
  for (const candidate of await nodeCandidates()) {
    if (!(await pathExists(candidate))) continue;
    try {
      const { stdout } = await execFile(candidate, ["--version"], {
        timeout: 3_000,
      });
      const version = parseNodeVersion(stdout);
      if (
        version &&
        version[0] >= SUPPORTED_NODE_MINIMUM &&
        version[0] < SUPPORTED_NODE_MAXIMUM_EXCLUSIVE
      ) {
        compatible.push({ executable: candidate, version });
      }
    } catch {
      // Ignore broken or non-executable candidates.
    }
  }
  compatible.sort(compareVersionsDescending);
  return compatible[0]?.executable ?? null;
};

export const runForge = async (command) => {
  if (!FORGE_COMMANDS.has(command)) {
    throw new Error(`Unsupported Electron Forge command: ${command}`);
  }
  const forgeEnvironment = {
    ...process.env,
    npm_config_user_agent: `npm/10.0.0 node/${process.version} ${process.platform} ${process.arch}`,
  };
  delete forgeEnvironment.NODE_INSTALLER;
  await runProcess(process.execPath, [forgeCli, command], {
    env: forgeEnvironment,
  });
};

const main = async () => {
  const command = process.argv[2];
  if (!FORGE_COMMANDS.has(command)) {
    throw new Error("Usage: node ./scripts/run-forge.mjs <package|make>");
  }

  if (!isSupportedNodeVersion(process.version)) {
    const compatibleNode = await findCompatibleNode();
    if (!compatibleNode) {
      throw new Error(
        "No compatible Node.js installation found. Install Node 22, 23, or 24 and retry.",
      );
    }
    console.log(
      `[desktop-build] switching from unsupported Node ${process.version} to ${compatibleNode}`,
    );
    await runProcess(compatibleNode, [scriptPath, command]);
    return;
  }

  console.log(`[desktop-build] running Forge with Node ${process.version}`);
  await runForge(command);
};

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;

if (isEntrypoint) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack : String(error);
    console.error(`[desktop-build] failed\n${message}`);
    process.exitCode = 1;
  });
}
