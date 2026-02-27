import { useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { SETTINGS_SECTIONS, getSettingsSection } from "./settings-sections";
import type { SettingsSection } from "./settings-section";
import { useSettingsPageActions, useSettingsPageState } from "./settings-page-context";

export function SettingsPage({
  section,
  onSectionChange,
}: {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}) {
  const actions = useSettingsPageActions();
  const { loading, loadError } = useSettingsPageState();
  const selectedSection = getSettingsSection(section);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const handleTabKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const ids = SETTINGS_SECTIONS.map((candidate) => candidate.id);
    const currentIndex = ids.indexOf(section);
    let nextIndex: number | null = null;

    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % ids.length;
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + ids.length) % ids.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = ids.length - 1;
    }

    if (nextIndex !== null) {
      e.preventDefault();
      const nextId = ids[nextIndex]!;
      onSectionChange(nextId);
      tabRefs.current.get(nextId)?.focus();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <h1 className="sr-only">Settings</h1>

      <nav
        className="border-border bg-muted/30 flex w-[180px] shrink-0 flex-col gap-1 border-r p-3"
        role="tablist"
        aria-label="Settings sections"
        aria-orientation="vertical"
      >
        {SETTINGS_SECTIONS.map((s) => {
          const isSelected = section === s.id;
          return (
            <button
              key={s.id}
              ref={(el) => {
                if (el) tabRefs.current.set(s.id, el);
                else tabRefs.current.delete(s.id);
              }}
              id={`settings-tab-${s.id}`}
              role="tab"
              aria-selected={isSelected}
              aria-controls="settings-tabpanel"
              tabIndex={isSelected ? 0 : -1}
              className={`flex items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors ${
                isSelected
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => onSectionChange(s.id)}
              onKeyDown={handleTabKeyDown}
            >
              <s.icon size={14} />
              {s.label}
            </button>
          );
        })}
      </nav>

      <div
        id="settings-tabpanel"
        role="tabpanel"
        aria-labelledby={`settings-tab-${section}`}
        className="flex-1 overflow-y-auto p-6"
      >
        {loadError && (
          <div className="mb-4 flex items-center justify-between border border-destructive/30 bg-destructive/5 px-3 py-2">
            <p className="text-destructive text-xs">{loadError}</p>
            <button
              type="button"
              className="text-destructive/90 text-xs underline underline-offset-2"
              onClick={actions.reload}
            >
              Retry
            </button>
          </div>
        )}
        {loading ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
            Loading...
          </div>
        ) : (
          selectedSection.render()
        )}
      </div>
    </div>
  );
}
