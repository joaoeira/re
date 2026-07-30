import assert from "node:assert/strict";
import test from "node:test";

import { processIdsForExecutable } from "./install-local.mjs";
import { isSupportedNodeVersion, parseNodeVersion } from "./run-forge.mjs";

test("accepts the Node versions supported by the desktop package", () => {
  assert.equal(isSupportedNodeVersion("v21.9.0"), false);
  assert.equal(isSupportedNodeVersion("v22.0.0"), true);
  assert.equal(isSupportedNodeVersion("v24.99.0"), true);
  assert.equal(isSupportedNodeVersion("v25.0.0"), false);
  assert.deepEqual(parseNodeVersion("v24.7.0\n"), [24, 7, 0]);
});

test("matches only the main process for the installed app", () => {
  const executable = "/Applications/re Desktop.app/Contents/MacOS/re-desktop";
  const processList = [
    ` 123 ${executable}`,
    ` 124 ${executable} --some-argument`,
    " 125 /Applications/re Desktop.app/Contents/Frameworks/re Desktop Helper.app/Contents/MacOS/re Desktop Helper",
    " 126 /bin/zsh -lc pgrep re-desktop",
  ].join("\n");

  assert.deepEqual(processIdsForExecutable(processList, executable), [123, 124]);
});
