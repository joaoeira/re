import { useEffect } from "react";
import { Outlet, createRootRoute, useRouterState } from "@tanstack/react-router";

import { useSettingsStore } from "@shared/state/stores-context";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { SettingsDialog } from "@/components/settings/settings-dialog";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isEditorRoute = pathname === "/editor";
  const settingsStore = useSettingsStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "," && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        settingsStore.send({ type: "openSettings" });
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [settingsStore]);

  if (isEditorRoute) {
    return (
      <>
        <Outlet />
        <SettingsDialog />
      </>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <Outlet />
      </div>
      <SettingsDialog />
    </div>
  );
}
