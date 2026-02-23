import { createStore } from "@xstate/store";

export type SettingsSection = "general" | "secrets";

export const createSettingsStore = () =>
  createStore({
    context: {
      open: false,
      section: "general" as SettingsSection,
    },
    on: {
      openSettings: (context) => ({
        ...context,
        open: true,
      }),
      openSettingsSection: (context, event: { section: SettingsSection }) => ({
        ...context,
        open: true,
        section: event.section,
      }),
      setSection: (context, event: { section: SettingsSection }) => ({
        ...context,
        section: event.section,
      }),
      closeSettings: (context) => ({
        ...context,
        open: false,
      }),
    },
  });

export type SettingsStore = ReturnType<typeof createSettingsStore>;
