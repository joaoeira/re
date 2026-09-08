import type { Result, ReviewStatus } from "./workspace";

// Mirrors the route constants in native/panel.m.
export const menuRoutes = { quit: 1, review: 2, create: 3, refresh: 4, preferences: 5 } as const;
export type MenuRoute = keyof typeof menuRoutes;
type MenuItem =
  | { readonly separator: true }
  | { readonly title: string; readonly icon?: string; readonly route?: number };
export interface StatusMenu {
  readonly title: string;
  readonly tooltip: string;
  readonly items: readonly MenuItem[];
}
const countLabel = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;

export function statusMenu(status: Result<ReviewStatus> | null, scratch = false): StatusMenu {
  const items: MenuItem[] = [];
  let title = "";
  let tooltip = "Loading review status";
  if (status?.ok) {
    const value = status.value;
    title = value.due === 0 ? "" : String(value.due);
    tooltip =
      value.due === 0 ? "No cards due now" : countLabel(value.due, "card due now", "cards due now");
    items.push(
      {
        title: countLabel(value.due, "card due now", "cards due now"),
        icon: value.due ? "clock" : "checkmark.circle",
      },
      { title: countLabel(value.new, "new card", "new cards"), icon: "plus.circle" },
      { title: countLabel(value.total, "total card", "total cards"), icon: "square.3.layers.3d" },
    );
    if (value.unavailableDecks)
      items.push({
        title: countLabel(value.unavailableDecks, "deck unavailable", "decks unavailable"),
        icon: "exclamationmark.triangle",
      });
    if (scratch) items.push({ title: "Scratch deck · practice without scheduling" });
  } else if (status) {
    tooltip = "Could not load review status";
    items.push({ title: tooltip, icon: "exclamationmark.triangle" }, { title: status.error });
  } else items.push({ title: tooltip });
  items.push(
    { separator: true },
    { title: "Review Cards", icon: "eye", route: menuRoutes.review },
    { title: "Create Card", icon: "plus", route: menuRoutes.create },
    { separator: true },
    { title: "Refresh", icon: "arrow.clockwise", route: menuRoutes.refresh },
    { title: "Choose Workspace…", icon: "gearshape", route: menuRoutes.preferences },
    { separator: true },
    { title: "Quit re Pocket", route: menuRoutes.quit },
  );
  return { title, tooltip, items };
}
