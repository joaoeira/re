import { Home, Table2, Sparkles, Settings } from "lucide-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const navItems = [
  { id: "home", label: "Home", icon: Home, to: "/" },
  { id: "browser", label: "Card Browser", icon: Table2, to: null },
  { id: "create", label: "AI Creator", icon: Sparkles, to: null },
] as const;

export function Sidebar() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      className="flex w-12 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-2"
      aria-label="Main navigation"
    >
      <TooltipProvider>
        <div className="flex flex-1 flex-col items-center gap-1">
          {navItems.map((item) => {
            const isActive = item.to !== null && pathname === item.to;
            const isDisabled = item.to === null;
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger
                  className={`flex size-9 items-center justify-center transition-colors ${
                    isActive
                      ? "text-sidebar-foreground"
                      : isDisabled
                        ? "text-sidebar-foreground/30"
                        : "text-sidebar-foreground/60 hover:text-sidebar-foreground"
                  }`}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                  aria-disabled={isDisabled || undefined}
                  onClick={() => {
                    if (item.to) void navigate({ to: item.to });
                  }}
                >
                  <item.icon size={18} />
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <Tooltip>
          <TooltipTrigger
            className="flex size-9 items-center justify-center text-sidebar-foreground/30 transition-colors"
            aria-label="Settings"
            aria-disabled="true"
          >
            <Settings size={18} />
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </nav>
  );
}
