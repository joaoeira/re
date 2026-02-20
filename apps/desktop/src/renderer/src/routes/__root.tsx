import { Outlet, createRootRoute } from "@tanstack/react-router";

import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <Outlet />
      </div>
    </div>
  );
}
