import { PdfUploadZone } from "@/components/forge/pdf-upload-zone";

export function ForgePage() {
  return (
    <main className="flex flex-1 overflow-auto bg-background px-6 py-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <PdfUploadZone />
      </div>
    </main>
  );
}
