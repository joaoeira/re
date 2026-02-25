import { createFileRoute } from "@tanstack/react-router";

import { SettingsPageProvider } from "@/components/settings/settings-page-context";
import { SettingsPage } from "@/components/settings/settings-page";
import type { SettingsSection } from "@/components/settings/settings-section";

type SettingsSearch = {
  section?: SettingsSection;
};

const normalizeSection = (section: unknown): SettingsSection =>
  section === "secrets" ? "secrets" : "general";

export const Route = createFileRoute("/settings")({
  validateSearch: (search): SettingsSearch => ({
    section: normalizeSection((search as Record<string, unknown>).section),
  }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const navigate = Route.useNavigate();
  const { section = "general" } = Route.useSearch();

  return (
    <SettingsPageProvider>
      <SettingsPage
        section={section}
        onSectionChange={(nextSection) => {
          void navigate({
            search: (prev) => ({
              ...prev,
              section: nextSection,
            }),
          });
        }}
      />
    </SettingsPageProvider>
  );
}
