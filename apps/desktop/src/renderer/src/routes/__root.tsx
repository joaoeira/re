import { useEffect } from "react";
import { Outlet, createRootRoute, useNavigate, useRouterState } from "@tanstack/react-router";

import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isEditorRoute = pathname === "/editor";

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "," && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void navigate({
          to: "/settings",
          search: { section: "general" },
        });
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  if (isEditorRoute) {
    return <Outlet />;
  }

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
