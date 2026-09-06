import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

import { _electron as electron, test, expect } from "@playwright/test";

const desktopDir = fileURLToPath(new URL("../", import.meta.url));

test("packaged desktop loads its renderer, IPC, and SQLite with fresh user data", async () => {
  const output = path.join(desktopDir, "out");
  const bundle = (await readdir(output)).find((name) =>
    name.endsWith(`-${process.platform}-${process.arch}`),
  );
  expect(bundle, "Run npm run build or npm run package before the smoke test").toBeTruthy();
  const resources =
    process.platform === "darwin"
      ? path.join(output, bundle!, "re Desktop.app", "Contents", "Resources")
      : path.join(output, bundle!, "resources");
  const entry = path.join(resources, "app.asar", ".vite", "build", "main.js");
  await access(path.join(resources, "app.asar"));
  const scratch = await mkdtemp(path.join(tmpdir(), "re-desktop-smoke-"));
  const userData = path.join(scratch, "user-data");
  const bootstrap = path.join(scratch, "bootstrap.cjs");
  // Use the development Electron host for Playwright's debugger connection while
  // exercising the packaged payload, including its rebuilt native dependencies.
  await writeFile(
    bootstrap,
    `
    const { app } = require("electron");
    app.setPath("userData", ${JSON.stringify(userData)});
    import(${JSON.stringify(pathToFileURL(entry).href)});
  `,
  );
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ args: [bootstrap] });
    const page = await app.firstWindow();
    await expect(
      page.getByText("No workspace configured. Set a workspace root path in settings."),
    ).toBeVisible();
    await app.close();
    app = undefined;
    const db = new DatabaseSync(path.join(userData, "re.db"), { readOnly: true });
    try {
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'forge_topic_angles'").get(),
      ).toMatchObject({ name: "forge_topic_angles" });
    } finally {
      db.close();
    }
  } finally {
    await app?.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
