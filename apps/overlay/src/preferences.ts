import { existsSync, readFileSync } from "node:fs";
import { preferencesPath, writeFileAtomically } from "./storage";

export interface Preferences {
  root: string | null;
  deck: string;
  cardType: "qa" | "cloze";
}
export function loadPreferences(): Preferences {
  const defaults: Preferences = {
    root: null,
    deck: "scratch",
    cardType: "qa",
  };
  if (!existsSync(preferencesPath)) return defaults;
  try {
    const value = JSON.parse(readFileSync(preferencesPath, "utf8"));
    return {
      root: typeof value.root === "string" ? value.root : null,
      deck: typeof value.deck === "string" ? value.deck : "scratch",
      cardType: value.cardType === "cloze" ? "cloze" : "qa",
    };
  } catch {
    return defaults;
  }
}
export function savePreferences(preferences: Preferences): void {
  writeFileAtomically(preferencesPath, JSON.stringify(preferences, null, 2));
}
