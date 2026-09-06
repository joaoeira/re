import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const supportDirectory = join(homedir(), "Library", "Application Support", "re-pocket");
export const cardsPath = process.env.RE_POCKET_DATA ?? join(supportDirectory, "cards.json");
export const preferencesPath = join(dirname(cardsPath), "preferences.json");
// The Raycast scripts cannot see RE_POCKET_DATA, so the launch channel stays fixed.
export const launchInboxPath = join(supportDirectory, "launch-request");

export function writeFileAtomically(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, contents, { mode: 0o600 });
  renameSync(temporary, path);
}
