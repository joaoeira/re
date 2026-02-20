import { useEffect } from "react";
import { Plus } from "lucide-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function Topbar() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isReview = pathname === "/review";

  useEffect(() => {
    if (!isReview) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        void navigate({ to: "/" });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isReview, navigate]);

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
      <nav className="flex items-center gap-1 text-sm" aria-label="Breadcrumb">
        <button
          type="button"
          onClick={() => void navigate({ to: "/" })}
          className="text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Home"
        >
          ~
        </button>
        <span className="text-muted-foreground/40">/</span>
        {isReview ? (
          <>
            <button
              type="button"
              onClick={() => void navigate({ to: "/" })}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              home
            </button>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-foreground" aria-current="page">
              review
            </span>
          </>
        ) : (
          <span className="text-foreground" aria-current="page">
            home
          </span>
        )}
      </nav>

      {isReview ? (
        <button
          type="button"
          onClick={() => void navigate({ to: "/" })}
          className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="text-xs">Exit</span>
          <kbd className="border border-border px-1 py-0.5 text-[10px] text-muted-foreground">
            Esc
          </kbd>
        </button>
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger className="flex size-7 items-center justify-center border border-border text-muted-foreground transition-colors hover:border-foreground hover:text-foreground">
              <Plus className="size-3.5" />
              <span className="sr-only">Add</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">Add</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </header>
  );
}
