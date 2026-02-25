export const SETTINGS_SECTION_IDS = ["general", "secrets"] as const;

export type SettingsSection = (typeof SETTINGS_SECTION_IDS)[number];

export const DEFAULT_SETTINGS_SECTION: SettingsSection = "general";

export const isSettingsSection = (value: unknown): value is SettingsSection =>
  typeof value === "string" && SETTINGS_SECTION_IDS.some((section) => section === value);
