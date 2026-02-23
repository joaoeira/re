import { describe, expect, it } from "vitest";

import { createSettingsStore } from "@shared/state/settingsStore";

describe("settingsStore", () => {
  it("starts closed on the general section", () => {
    const store = createSettingsStore();
    const { open, section } = store.getSnapshot().context;

    expect(open).toBe(false);
    expect(section).toBe("general");
  });

  it("openSettings sets open to true", () => {
    const store = createSettingsStore();
    store.send({ type: "openSettings" });

    expect(store.getSnapshot().context.open).toBe(true);
  });

  it("openSettings preserves the current section", () => {
    const store = createSettingsStore();
    store.send({ type: "setSection", section: "secrets" });
    store.send({ type: "openSettings" });

    expect(store.getSnapshot().context.section).toBe("secrets");
  });

  it("openSettingsSection opens to a specific section", () => {
    const store = createSettingsStore();
    store.send({ type: "openSettingsSection", section: "secrets" });

    const { open, section } = store.getSnapshot().context;
    expect(open).toBe(true);
    expect(section).toBe("secrets");
  });

  it("setSection changes the section while keeping open state", () => {
    const store = createSettingsStore();
    store.send({ type: "openSettings" });
    store.send({ type: "setSection", section: "secrets" });

    const { open, section } = store.getSnapshot().context;
    expect(open).toBe(true);
    expect(section).toBe("secrets");
  });

  it("closeSettings sets open to false and preserves section", () => {
    const store = createSettingsStore();
    store.send({ type: "openSettingsSection", section: "secrets" });
    store.send({ type: "closeSettings" });

    const { open, section } = store.getSnapshot().context;
    expect(open).toBe(false);
    expect(section).toBe("secrets");
  });
});
