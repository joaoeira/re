import type { ReactNode } from "react";
import { KeyRound, Settings2 } from "lucide-react";

import { GeneralSettingsSection } from "./general-settings-section";
import { SecretsSettingsSection } from "./secrets-settings-section";
import type { SettingsSection } from "./settings-section";

type SettingsSectionDefinition = {
  readonly id: SettingsSection;
  readonly label: string;
  readonly icon: typeof Settings2;
  readonly render: () => ReactNode;
};

export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  {
    id: "general",
    label: "General",
    icon: Settings2,
    render: () => <GeneralSettingsSection />,
  },
  {
    id: "secrets",
    label: "Secrets",
    icon: KeyRound,
    render: () => <SecretsSettingsSection />,
  },
];

export const getSettingsSection = (section: SettingsSection): SettingsSectionDefinition =>
  SETTINGS_SECTIONS.find((candidate) => candidate.id === section) ?? SETTINGS_SECTIONS[0]!;
