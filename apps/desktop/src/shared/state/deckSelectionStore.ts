import { createStore } from "@xstate/store";

export const deckSelectionStore = createStore({
  context: {
    selected: {} as Record<string, true>,
  },
  on: {
    toggleDeck: (context, event: { path: string }) => {
      const next = { ...context.selected };

      if (event.path in next) {
        delete next[event.path];
      } else {
        next[event.path] = true;
      }

      return { ...context, selected: next };
    },
    toggleFolder: (context, event: { path: string; descendantPaths: readonly string[] }) => {
      const next = { ...context.selected };
      const allSelected =
        event.descendantPaths.length > 0 &&
        event.descendantPaths.every((descendantPath) => descendantPath in next);

      for (const descendantPath of event.descendantPaths) {
        if (allSelected) {
          delete next[descendantPath];
        } else {
          next[descendantPath] = true;
        }
      }

      return { ...context, selected: next };
    },
    clear: (context) => ({
      ...context,
      selected: {} as Record<string, true>,
    }),
  },
});

