import type { ForgeSessionSummary, ForgeSessionStatus } from "@shared/rpc/schemas/forge";

import { ForgeSourceCanvas } from "./forge-source-canvas";

function timeAgo(dateString: string): string {
  const seconds = Math.floor((Date.now() - Date.parse(dateString)) / 1000);
  if (seconds < 60) return "just now";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function stepMeta(status: ForgeSessionStatus): {
  label: string;
  colorClass: string;
  pulse: boolean;
} {
  switch (status) {
    case "created":
    case "extracting":
      return {
        label: "Extracting",
        colorClass: "bg-amber-500",
        pulse: true,
      };
    case "extracted":
    case "topics_extracting":
      return {
        label: "Extracting topics",
        colorClass: "bg-amber-500",
        pulse: true,
      };
    case "topics_extracted":
      return {
        label: "Topics ready",
        colorClass: "bg-blue-400",
        pulse: false,
      };
    case "generating":
      return {
        label: "Generating cards",
        colorClass: "bg-emerald-500",
        pulse: true,
      };
    case "ready":
      return {
        label: "Reviewing cards",
        colorClass: "bg-emerald-500",
        pulse: false,
      };
    case "error":
      return {
        label: "Error",
        colorClass: "bg-destructive",
        pulse: false,
      };
  }
}

function SessionRow({
  session,
  onResume,
}: {
  readonly session: ForgeSessionSummary;
  readonly onResume: (session: ForgeSessionSummary) => void;
}) {
  const meta = stepMeta(session.status);

  return (
    <button
      type="button"
      onClick={() => onResume(session)}
      className="group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.colorClass} ${meta.pulse ? "animate-pulse" : ""}`}
          />
          <span className="truncate text-sm text-foreground">{session.sourceLabel}</span>
        </div>
        <div className="flex items-center gap-1.5 pl-3.5">
          <span className="text-xs text-muted-foreground">{meta.label}</span>
          {session.topicCount > 0 ? (
            <>
              <span className="text-muted-foreground/30">·</span>
              <span className="font-mono text-xs text-muted-foreground">
                {session.topicCount} topics
              </span>
            </>
          ) : null}
          {session.cardCount > 0 ? (
            <>
              <span className="text-muted-foreground/30">·</span>
              <span className="font-mono text-xs text-muted-foreground">
                {session.cardCount} cards
              </span>
            </>
          ) : null}
        </div>
      </div>
      <span className="shrink-0 text-[10px] text-muted-foreground/50">
        {timeAgo(session.updatedAt)}
      </span>
    </button>
  );
}

export function SessionBrowser({
  sessions,
  onResume,
  onFileSelected,
  onOpenTextEditor,
  errorMessage,
}: {
  readonly sessions: ReadonlyArray<ForgeSessionSummary>;
  readonly onResume: (session: ForgeSessionSummary) => void;
  readonly onFileSelected: (file: File | null) => void;
  readonly onOpenTextEditor: () => void;
  readonly errorMessage?: string | null;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <ForgeSourceCanvas
        compact
        onOpenTextEditor={onOpenTextEditor}
        onPdfSelected={onFileSelected}
      />

      {errorMessage ? (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage}
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <span className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
          In progress
        </span>
        {sessions.map((session) => (
          <SessionRow key={session.id} session={session} onResume={onResume} />
        ))}
      </div>
    </div>
  );
}
