import { Fragment, useEffect } from "react";
import { Plus } from "lucide-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { gitSyncSnapshotHasWork, toGitSyncSnapshotMessage } from "@shared/git";
import { useRunGitSyncMutation } from "@/hooks/mutations/use-run-git-sync-mutation";
import { useOpenEditorWindowMutation } from "@/hooks/mutations/use-open-editor-window-mutation";
import { useGitSyncSnapshotQuery } from "@/hooks/queries/use-git-sync-snapshot-query";
import { useSettingsQuery } from "@/hooks/queries/use-settings-query";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Crumb = { label: string; navigate?: () => void };

function useBreadcrumbs(): ReadonlyArray<Crumb> {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const forgeFile = useRouterState({
    select: (s) => {
      if (s.location.pathname !== "/forge") return null;
      const source = (s.location.search as Record<string, unknown>).source;
      return typeof source === "string" && source.length > 0 ? source : null;
    },
  });

  const goHome = () => void navigate({ to: "/" });
  const goForge = () => void navigate({ to: "/forge", search: { session: null, source: null } });

  const crumbs: Crumb[] = [{ label: "home", navigate: goHome }];

  if (pathname === "/forge" && forgeFile) {
    crumbs.push({ label: "forge", navigate: goForge });
    crumbs.push({ label: forgeFile });
  } else if (pathname === "/forge") {
    crumbs.push({ label: "forge" });
  } else if (pathname === "/review") {
    crumbs.push({ label: "review" });
  } else if (pathname === "/settings") {
    crumbs.push({ label: "settings" });
  }

  return crumbs;
}

export function Topbar() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isReview = pathname === "/review";
  const isSettings = pathname === "/settings";
  const { mutate: openEditorWindow } = useOpenEditorWindowMutation();
  const settingsQuery = useSettingsQuery();
  const rootPath = settingsQuery.data?.workspace.rootPath ?? null;
  const gitSyncSnapshotQuery = useGitSyncSnapshotQuery(rootPath);
  const runGitSyncMutation = useRunGitSyncMutation();
  const crumbs = useBreadcrumbs();

  useEffect(() => {
    if (!isReview) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        void navigate({ to: "/" });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isReview, navigate]);

  const syncSnapshot = gitSyncSnapshotQuery.data ?? null;
  const syncHasWork = syncSnapshot ? gitSyncSnapshotHasWork(syncSnapshot) : false;
  const syncDisabled =
    settingsQuery.isPending ||
    settingsQuery.isError ||
    rootPath === null ||
    gitSyncSnapshotQuery.isPending ||
    gitSyncSnapshotQuery.isError ||
    syncSnapshot === null ||
    syncSnapshot._tag !== "GitSyncReady" ||
    !syncHasWork ||
    runGitSyncMutation.isPending;

  const syncTooltip = (() => {
    if (runGitSyncMutation.isError) {
      return runGitSyncMutation.error.message;
    }

    if (settingsQuery.isError) {
      return `Failed to load settings: ${settingsQuery.error.message}`;
    }

    if (rootPath === null) {
      return "Set a workspace root in settings to enable git sync.";
    }

    if (gitSyncSnapshotQuery.isPending) {
      return "Checking git sync status...";
    }

    if (gitSyncSnapshotQuery.isError) {
      return gitSyncSnapshotQuery.error.message;
    }

    if (syncSnapshot) {
      if (syncSnapshot._tag === "GitSyncReady" && !syncHasWork) {
        return "Workspace is already in sync.";
      }
      return toGitSyncSnapshotMessage(syncSnapshot) ?? "Sync workspace via git.";
    }

    return "Sync workspace via git.";
  })();

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
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <Fragment key={crumb.label}>
              <span className="text-muted-foreground/40">/</span>
              {isLast ? (
                <span className="text-foreground" aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={crumb.navigate}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </button>
              )}
            </Fragment>
          );
        })}
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
      ) : isSettings ? (
        <div className="size-7" aria-hidden />
      ) : (
        <TooltipProvider>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger className="inline-flex">
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={syncDisabled}
                    aria-busy={runGitSyncMutation.isPending}
                    onClick={() => {
                      if (!rootPath) return;
                      runGitSyncMutation.mutate({ rootPath });
                    }}
                  >
                    <span aria-live="polite">
                      {runGitSyncMutation.isPending ? "Syncing..." : "Sync"}
                    </span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">{syncTooltip}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                className="flex size-7 items-center justify-center border border-border text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
                onClick={() => {
                  openEditorWindow({ mode: "create" });
                }}
              >
                <Plus className="size-3.5" />
                <span className="sr-only">Add</span>
              </TooltipTrigger>
              <TooltipContent side="bottom">Add</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      )}
    </header>
  );
}
