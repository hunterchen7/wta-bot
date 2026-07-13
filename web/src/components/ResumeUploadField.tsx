import { useRef, useState, type DragEvent } from "react";
import {
  Download,
  FileText,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import type { ResumeSummary } from "../api";
import { Button } from "./ui/button";

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const RESUME_EXTENSIONS = [".pdf", ".doc", ".docx", ".odt", ".rtf"];

type Props = {
  current: ResumeSummary | null;
  stagedFile: File | null;
  removePending: boolean;
  downloadHref?: string;
  disabled?: boolean;
  error?: string;
  onFileChange: (file: File | null) => void;
  onRemove: () => void;
  onRestore: () => void;
  onError: (message: string) => void;
};

export function ResumeUploadField({
  current,
  stagedFile,
  removePending,
  downloadHref,
  disabled = false,
  error,
  onFileChange,
  onRemove,
  onRestore,
  onError,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const visibleFile = stagedFile
    ? { filename: stagedFile.name, bytes: stagedFile.size }
    : current;

  const choose = (file: File | null) => {
    if (!file || disabled) return;
    const extension = RESUME_EXTENSIONS.find((value) =>
      file.name.toLowerCase().endsWith(value),
    );
    if (!extension) {
      onError("Use a PDF, DOC, DOCX, ODT, or RTF file.");
      return;
    }
    if (file.size > MAX_RESUME_BYTES) {
      onError("Resume files must be 10 MB or smaller.");
      return;
    }
    if (!file.size) {
      onError("That file is empty. Choose a different resume.");
      return;
    }
    onError("");
    onFileChange(file);
    if (input.current) input.current.value = "";
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0] ?? null);
  };

  if (removePending) {
    return (
      <div
        className="flex min-h-28 items-center justify-between gap-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50/70 p-4 transition-all motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 dark:border-amber-800 dark:bg-amber-950/20"
        aria-live="polite"
      >
        <div>
          <div className="font-bold text-amber-950 dark:text-amber-100">
            Resume will be removed
          </div>
          <p className="mt-1 text-sm text-amber-800/80 dark:text-amber-200/70">
            This takes effect when you save all changes.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onRestore} disabled={disabled}>
          <RotateCcw /> Undo
        </Button>
      </div>
    );
  }

  if (visibleFile) {
    return (
      <div
        className={`rounded-2xl border p-4 transition-all motion-safe:animate-in motion-safe:fade-in ${error ? "border-destructive ring-2 ring-destructive/15" : "border-border bg-muted/20"}`}
      >
        <input
          ref={input}
          type="file"
          accept=".pdf,.doc,.docx,.odt,.rtf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,application/rtf,text/rtf"
          className="sr-only"
          disabled={disabled}
          onChange={(event) => choose(event.target.files?.[0] ?? null)}
        />
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <FileText className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-black text-foreground">
              {visibleFile.filename}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatBytes(visibleFile.bytes)}
              {stagedFile
                ? current
                  ? " · Replaces your current resume when saved"
                  : " · Ready to upload when saved"
                : current?.uploadedAt
                  ? ` · Uploaded ${formatDate(current.uploadedAt)}`
                  : ""}
            </p>
          </div>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {current && !stagedFile && downloadHref ? (
            <Button asChild type="button" variant="outline" size="sm">
              <a href={downloadHref} target="_blank" rel="noreferrer">
                <Download /> Download
              </a>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            <RefreshCw /> Replace
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="text-destructive hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 /> Remove
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
      className={`relative grid min-h-40 place-items-center rounded-2xl border border-dashed p-6 text-center transition-colors ${dragging ? "border-primary bg-primary/10" : error ? "border-destructive bg-destructive/5" : "border-border bg-muted/20 hover:bg-accent/45"} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
    >
      <input
        ref={input}
        type="file"
        aria-label="Upload an optional resume"
        accept=".pdf,.doc,.docx,.odt,.rtf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,application/rtf,text/rtf"
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        disabled={disabled}
        onChange={(event) => choose(event.target.files?.[0] ?? null)}
      />
      <div className="pointer-events-none">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <Upload className="size-5" />
        </span>
        <div className="mt-4 text-sm font-black text-foreground">
          {dragging ? "Drop your resume here" : "Choose or drop a resume"}
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          PDF, DOC, DOCX, ODT, or RTF · up to 10 MB
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "recently"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
