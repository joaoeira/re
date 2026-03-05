import { useRef, useState } from "react";

import type { ForgeSessionSummary, ForgeSessionStatus } from "@shared/rpc/schemas/forge";

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
  detail: string;
  colorClass: string;
  pulse: boolean;
} {
  switch (status) {
    case "created":
    case "extracting":
      return {
        label: "Extracting",
        detail: "text extraction in progress",
        colorClass: "bg-amber-500",
        pulse: true,
      };
    case "extracted":
    case "topics_extracting":
      return {
        label: "Extracting topics",
        detail: "topic analysis in progress",
        colorClass: "bg-amber-500",
        pulse: true,
      };
    case "topics_extracted":
      return {
        label: "Topics ready",
        detail: "awaiting topic selection",
        colorClass: "bg-blue-400",
        pulse: false,
      };
    case "generating":
      return {
        label: "Generating cards",
        detail: "card generation in progress",
        colorClass: "bg-emerald-500",
        pulse: true,
      };
    case "ready":
      return {
        label: "Reviewing cards",
        detail: "cards ready for review",
        colorClass: "bg-emerald-500",
        pulse: false,
      };
    case "error":
      return {
        label: "Error",
        detail: "session encountered an error",
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

const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const isPdfFile = (file: File): boolean =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

export function SessionBrowser({
  sessions,
  onResume,
  onFileSelected,
  errorMessage,
}: {
  readonly sessions: ReadonlyArray<ForgeSessionSummary>;
  readonly onResume: (session: ForgeSessionSummary) => void;
  readonly onFileSelected: (file: File | null) => void;
  readonly errorMessage?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  const acceptFile = (file: File | null) => {
    if (!file) return;
    if (!isPdfFile(file)) {
      setDropError("Only PDF files are supported.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setDropError(`PDF must be smaller than ${MAX_FILE_SIZE_MB} MB.`);
      return;
    }
    setDropError(null);
    onFileSelected(file);
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
          setIsDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files[0] ?? null;
          acceptFile(file);
        }}
        className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
          isDragging
            ? "border-primary/70 bg-primary/10"
            : "border-border/50 bg-muted/20 hover:border-border hover:bg-muted/40"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            acceptFile(e.currentTarget.files?.[0] ?? null);
            e.currentTarget.value = "";
          }}
        />
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          className="shrink-0 text-muted-foreground/60"
        >
          <path
            d="M12 16V4M12 4L8 8M12 4L16 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M20 16V18C20 19.1046 19.1046 20 18 20H6C4.89543 20 4 19.1046 4 18V16"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="min-w-0">
          <span className="text-sm text-muted-foreground">
            New session — drop a PDF or{" "}
            <span className="underline underline-offset-2">browse files</span>
          </span>
          {dropError ? (
            <p role="alert" className="mt-0.5 text-[10px] text-destructive">
              {dropError}
            </p>
          ) : null}
        </div>
      </div>

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
