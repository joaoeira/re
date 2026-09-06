import { readFileSync, renameSync, unlinkSync } from "node:fs";
import { launchInboxPath } from "./storage";

export type Screen = "create" | "review";

// Raycast atomically places an intent here before opening the app. Claim by
// rename so consuming this request cannot delete a newer one arriving meanwhile.
export function takeLaunchRequest(): Screen | null {
  const claimed = `${launchInboxPath}.${process.pid}.claimed`;
  try {
    renameSync(launchInboxPath, claimed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.error("Could not receive Raycast command", error);
    return null;
  }
  try {
    const screen = readFileSync(claimed, "utf8").trim();
    return screen === "create" || screen === "review" ? screen : null;
  } finally {
    unlinkSync(claimed);
  }
}
