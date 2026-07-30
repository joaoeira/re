#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { findCompatibleNode, isSupportedNodeVersion, runForge, runProcess } from "./run-forge.mjs";

const execFile = promisify(execFileCallback);
const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const desktopDir = path.resolve(scriptDir, "..");
const ensureLocalElectronScript = path.join(scriptDir, "ensure-local-electron.mjs");

const APP_BUNDLE_ID = "com.re.desktop";
const APPLICATIONS_DIR = "/Applications";
const LAUNCH_TIMEOUT_MS = 20_000;
const QUIT_TIMEOUT_MS = 10_000;
const STABILITY_WINDOW_MS = 4_000;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const pathExists = async (target) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

export const processIdsForExecutable = (processList, executablePath) =>
  processList
    .split("\n")
    .map((line) => /^ *(\d+) (.*)$/.exec(line))
    .filter(
      (match) =>
        match && (match[2] === executablePath || match[2].startsWith(`${executablePath} `)),
    )
    .map((match) => Number(match[1]));

const runningProcessIds = async (executablePath) => {
  const { stdout } = await execFile("/bin/ps", ["-ax", "-o", "pid=,command="]);
  return processIdsForExecutable(stdout, executablePath);
};

const waitFor = async (predicate, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(250);
  }
  return predicate();
};

const sha256 = async (target) => {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(target));
  return hash.digest("hex");
};

const plistValue = async (appPath, key) => {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  const { stdout } = await execFile("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plistPath]);
  return stdout.trim();
};

const verifyApp = async (appPath, { builtAfter } = {}) => {
  if (!(await pathExists(appPath))) {
    throw new Error(`Expected app bundle does not exist: ${appPath}`);
  }

  const asarPath = path.join(appPath, "Contents", "Resources", "app.asar");
  const asarStats = await fs.stat(asarPath);
  if (asarStats.size === 0) {
    throw new Error(`Packaged app has an empty app.asar: ${asarPath}`);
  }
  if (builtAfter && asarStats.mtimeMs < builtAfter - 2_000) {
    throw new Error(`Forge returned a stale app bundle from ${asarStats.mtime.toISOString()}`);
  }

  const bundleId = await plistValue(appPath, "CFBundleIdentifier");
  if (bundleId !== APP_BUNDLE_ID) {
    throw new Error(`Unexpected bundle identifier "${bundleId}" in ${appPath}`);
  }

  const integrityHash = await plistValue(appPath, "ElectronAsarIntegrity:Resources/app.asar:hash");
  if (!/^[a-f0-9]{64}$/i.test(integrityHash)) {
    throw new Error("Packaged app is missing Electron ASAR integrity metadata");
  }

  await execFile("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);

  return {
    asarHash: await sha256(asarPath),
    executable: await plistValue(appPath, "CFBundleExecutable"),
  };
};

const moveBundle = async (source, destination) => {
  try {
    await fs.rename(source, destination);
  } catch (error) {
    if (!(error instanceof Error) || error.code !== "EXDEV") throw error;
    await runProcess("/usr/bin/ditto", [source, destination]);
    await fs.rm(source, { recursive: true });
  }
};

const quitInstalledApp = async (installedApp, executable) => {
  const executablePath = path.join(installedApp, "Contents", "MacOS", executable);
  if ((await runningProcessIds(executablePath)).length === 0) return;

  try {
    await execFile("/usr/bin/osascript", ["-e", `tell application id "${APP_BUNDLE_ID}" to quit`]);
  } catch {
    // Fall back to a signal if AppleScript cannot address the app.
  }

  if (
    await waitFor(
      async () => (await runningProcessIds(executablePath)).length === 0,
      QUIT_TIMEOUT_MS,
    )
  ) {
    return;
  }

  for (const pid of await runningProcessIds(executablePath)) {
    process.kill(pid, "SIGTERM");
  }
  if (!(await waitFor(async () => (await runningProcessIds(executablePath)).length === 0, 5_000))) {
    throw new Error("The existing re Desktop process would not quit");
  }
};

const launchAndVerify = async (installedApp, executable) => {
  const executablePath = path.join(installedApp, "Contents", "MacOS", executable);
  await execFile("/usr/bin/open", [installedApp]);
  const launched = await waitFor(
    async () => (await runningProcessIds(executablePath)).length > 0,
    LAUNCH_TIMEOUT_MS,
  );
  if (!launched) {
    throw new Error("The installed app did not start within 20 seconds");
  }

  await sleep(STABILITY_WINDOW_MS);
  if ((await runningProcessIds(executablePath)).length === 0) {
    throw new Error("The installed app exited during its launch health check");
  }
};

const timestamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");

const buildApp = async (productName) => {
  const buildStartedAt = Date.now();
  console.log(`[desktop-install] building with Node ${process.version}`);

  await runProcess(process.execPath, [ensureLocalElectronScript]);
  await runForge("package");

  const builtApp = path.join(
    desktopDir,
    "out",
    `${productName}-${process.platform}-${process.arch}`,
    `${productName}.app`,
  );
  const verification = await verifyApp(builtApp, {
    builtAfter: buildStartedAt,
  });
  return { builtApp, verification };
};

const installApp = async (productName, builtApp, buildVerification) => {
  const installedApp = path.join(APPLICATIONS_DIR, `${productName}.app`);
  const stagingApp = path.join(APPLICATIONS_DIR, `.${productName}.installing-${process.pid}.app`);
  const backupDir = path.join(desktopDir, "out", "install-backups");
  const backupApp = path.join(backupDir, `${productName}-${timestamp()}-${process.pid}.app`);
  const failedDir = path.join(desktopDir, "out", "install-failures");
  const failedApp = path.join(failedDir, `${productName}-${timestamp()}-${process.pid}.app`);
  const hadInstalledApp = await pathExists(installedApp);

  await fs.rm(stagingApp, { recursive: true, force: true });
  try {
    console.log("[desktop-install] staging the new app in /Applications");
    await runProcess("/usr/bin/ditto", [builtApp, stagingApp]);
    const stagedVerification = await verifyApp(stagingApp);
    if (stagedVerification.asarHash !== buildVerification.asarHash) {
      throw new Error("The staged app does not match the freshly built app");
    }

    if (hadInstalledApp) {
      const installedExecutable = await plistValue(installedApp, "CFBundleExecutable");
      await quitInstalledApp(installedApp, installedExecutable);
      await fs.mkdir(backupDir, { recursive: true });
      await moveBundle(installedApp, backupApp);
    }

    await moveBundle(stagingApp, installedApp);
    const installedVerification = await verifyApp(installedApp);
    if (installedVerification.asarHash !== buildVerification.asarHash) {
      throw new Error("The installed app does not match the fresh build");
    }
    await launchAndVerify(installedApp, installedVerification.executable);

    console.log(
      `[desktop-install] installed and running ${installedApp}\n` +
        `[desktop-install] app.asar sha256 ${installedVerification.asarHash}`,
    );
    if (hadInstalledApp) {
      console.log(`[desktop-install] previous version backed up at ${backupApp}`);
    }
  } catch (error) {
    await fs.rm(stagingApp, { recursive: true, force: true });
    if (hadInstalledApp && (await pathExists(backupApp))) {
      try {
        if (await pathExists(installedApp)) {
          const failedExecutable = await plistValue(installedApp, "CFBundleExecutable");
          await quitInstalledApp(installedApp, failedExecutable);
          await fs.mkdir(failedDir, { recursive: true });
          await moveBundle(installedApp, failedApp);
        }
        await moveBundle(backupApp, installedApp);
        const restoredExecutable = await plistValue(installedApp, "CFBundleExecutable");
        await launchAndVerify(installedApp, restoredExecutable);
        console.error(
          `[desktop-install] install failed; restored and relaunched the previous app${
            (await pathExists(failedApp)) ? `. Failed bundle kept at ${failedApp}` : ""
          }`,
        );
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Installation and rollback both failed. Backup: ${backupApp}`,
        );
      }
    } else if (hadInstalledApp && (await pathExists(installedApp))) {
      const existingExecutable = await plistValue(installedApp, "CFBundleExecutable");
      await launchAndVerify(installedApp, existingExecutable);
      console.error(
        "[desktop-install] install failed before replacement; the existing app remains running",
      );
    }
    throw error;
  }
};

const main = async () => {
  if (process.platform !== "darwin") {
    throw new Error("Local app installation is currently supported on macOS");
  }

  if (!isSupportedNodeVersion(process.version)) {
    const compatibleNode = await findCompatibleNode();
    if (!compatibleNode) {
      throw new Error(
        "No compatible Node.js installation found. Install Node 22, 23, or 24 and retry.",
      );
    }
    console.log(
      `[desktop-install] switching from unsupported Node ${process.version} to ${compatibleNode}`,
    );
    await runProcess(compatibleNode, [scriptPath]);
    return;
  }

  const packageJson = JSON.parse(await fs.readFile(path.join(desktopDir, "package.json"), "utf8"));
  const productName = packageJson.productName;
  if (typeof productName !== "string" || productName.length === 0) {
    throw new Error("package.json must define productName");
  }

  const { builtApp, verification } = await buildApp(productName);
  await installApp(productName, builtApp, verification);
};

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;

if (isEntrypoint) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack : String(error);
    console.error(`[desktop-install] failed\n${message}`);
    process.exitCode = 1;
  });
}
