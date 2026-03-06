import { useRef, useState } from "react";
import { FileText, Type, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const forgePdfFileSizeLimitMb = 50;
const forgePdfFileSizeLimitBytes = forgePdfFileSizeLimitMb * 1024 * 1024;

const validateForgePdfFile = (file: File): string | null => {
  const isPdfFile = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdfFile) {
    return "Only PDF files are supported right now.";
  }

  if (file.size > forgePdfFileSizeLimitBytes) {
    return `PDF must be smaller than ${forgePdfFileSizeLimitMb} MB.`;
  }

  return null;
};

type ForgeSourceCanvasProps = {
  readonly compact?: boolean;
  readonly onOpenTextEditor: () => void;
  readonly onPdfSelected: (file: File | null) => void;
  readonly className?: string;
};

export function ForgeSourceCanvas({
  compact = false,
  onOpenTextEditor,
  onPdfSelected,
  className,
}: ForgeSourceCanvasProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const openFilePicker = () => {
    inputRef.current?.click();
  };

  const acceptFile = (file: File | null) => {
    if (!file) return;

    const validationError = validateForgePdfFile(file);
    if (validationError) {
      setErrorMessage(validationError);
      onPdfSelected(null);
      return;
    }

    setErrorMessage(null);
    onPdfSelected(file);
  };

  const onFileList = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    acceptFile(files[0] ?? null);
  };

  return (
    <section
      role="button"
      tabIndex={0}
      aria-label="Add forge source"
      className={cn(
        "group relative overflow-hidden border transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-1",
        compact ? "px-4 py-3" : "px-5 py-5",
        isDragging
          ? "border-primary/70 bg-primary/8"
          : "border-border bg-background hover:border-foreground/20 hover:bg-muted/30",
        className,
      )}
      onClick={() => {
        onOpenTextEditor();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenTextEditor();
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        setIsDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        onFileList(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        onClick={(event) => {
          event.stopPropagation();
        }}
        onChange={(event) => {
          onFileList(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground/70">
            <Upload className="size-4 shrink-0" />
            <Type className="size-4 shrink-0" />
          </div>

          <div className="space-y-1">
            <p className={cn("text-foreground", compact ? "text-sm" : "text-base")}>
              Drop a PDF, or click to paste text
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              PDFs keep the existing preview flow. Text opens a dedicated editor and extracts
              immediately when submitted.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-muted-foreground">
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="h-6 px-2"
              onClick={(event) => {
                event.stopPropagation();
                openFilePicker();
              }}
            >
              Browse PDF
            </Button>
            <span>PDF up to {forgePdfFileSizeLimitMb} MB</span>
          </div>

          {errorMessage ? (
            <p role="alert" className="text-[11px] text-destructive">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <div className="hidden shrink-0 items-center gap-2 text-[10px] text-muted-foreground sm:flex">
          <span className="inline-flex items-center gap-1 border border-border px-2 py-1">
            <FileText className="size-3" />
            PDF
          </span>
          <span className="inline-flex items-center gap-1 border border-border px-2 py-1">
            <Type className="size-3" />
            TXT
          </span>
        </div>
      </div>
    </section>
  );
}
