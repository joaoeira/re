import { createStore } from "@xstate/store";

export const deckListStore = createStore({
  context: {
    collapsed: {} as Record<string, true>,
  },
  on: {
    toggle: (context, event: { path: string }) => {
      const next = { ...context.collapsed };
      if (event.path in next) {
        delete next[event.path];
      } else {
        next[event.path] = true;
      }
      return { ...context, collapsed: next };
    },
    expandAll: (context) => ({
      ...context,
      collapsed: {} as Record<string, true>,
    }),
    collapseAll: (context, event: { paths: readonly string[] }) => {
      const next: Record<string, true> = {};
      for (const path of event.paths) {
        next[path] = true;
      }
      return { ...context, collapsed: next };
    },
  },
});
