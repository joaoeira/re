import { useRef, useState } from "react";
import { Upload } from "lucide-react";

const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const isPdfFile = (file: File): boolean =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

export function PdfUploadZone({
  onFileSelected,
}: {
  readonly onFileSelected: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const openFilePicker = () => {
    inputRef.current?.click();
  };

  const acceptFile = (file: File | null) => {
    if (!file) return;

    if (!isPdfFile(file)) {
      setSelectedFileName(null);
      setErrorMessage("Only PDF files are supported right now.");
      onFileSelected(null);
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setSelectedFileName(null);
      setErrorMessage(`PDF must be smaller than ${MAX_FILE_SIZE_MB} MB.`);
      onFileSelected(null);
      return;
    }

    setSelectedFileName(file.name);
    setErrorMessage(null);
    onFileSelected(file);
  };

  const onFileList = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    acceptFile(files[0] ?? null);
  };

  return (
    <section
      className={`flex cursor-pointer items-center gap-3 border px-4 py-5 transition-colors ${
        isDragging
          ? "border-primary/70 bg-primary/10"
          : "border-border bg-transparent hover:border-foreground/20 hover:bg-muted/50"
      }`}
      role="button"
      tabIndex={0}
      aria-label="Upload PDF source"
      onClick={openFilePicker}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openFilePicker();
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
        onChange={(event) => {
          onFileList(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />

      <Upload className="pointer-events-none size-4 shrink-0 text-muted-foreground" />

      <div className="min-w-0 space-y-0.5">
        <p className="text-xs text-foreground/85">
          Drop a PDF here, or{" "}
          <button
            type="button"
            className="text-foreground underline underline-offset-4 hover:text-foreground/70"
            onClick={(event) => {
              event.stopPropagation();
              openFilePicker();
            }}
          >
            browse files
          </button>
        </p>
        <p className="text-[10px] text-muted-foreground">PDF · up to 50 MB</p>
        {selectedFileName ? (
          <p className="text-[10px] text-foreground/80">{selectedFileName}</p>
        ) : null}
        {errorMessage ? (
          <p role="alert" className="text-[10px] text-destructive">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </section>
  );
}
