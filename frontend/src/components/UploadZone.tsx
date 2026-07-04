"use client";

import { useCallback, useRef, useState } from "react";
import { UploadCloud, Loader2, CheckCircle2 } from "lucide-react";
import { uploadPdf, type UploadResult, type UploadProgress } from "@/lib/api";

type Status =
  | { kind: "idle" }
  | { kind: "uploading" } // file in flight, server not yet reporting
  | { kind: "processing"; progress: UploadProgress }
  | { kind: "done" };

export default function UploadZone({
  chatId,
  onUploaded,
}: {
  chatId: string;
  onUploaded: (r: UploadResult) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = status.kind === "uploading" || status.kind === "processing";

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setError("Please choose a PDF file.");
        return;
      }
      setStatus({ kind: "uploading" });
      await uploadPdf(chatId, file, {
        onProgress: (progress) => setStatus({ kind: "processing", progress }),
        onDone: (result) => {
          setStatus({ kind: "done" });
          onUploaded(result);
          setTimeout(() => setStatus({ kind: "idle" }), 1200);
        },
        onError: (message) => {
          setError(message);
          setStatus({ kind: "idle" });
        },
      });
    },
    [chatId, onUploaded]
  );

  const pct = status.kind === "processing" ? Math.round(status.progress.pct * 100) : 0;
  const indeterminate = status.kind === "uploading";

  return (
    <div>
      <label
        onDragOver={(e) => {
          if (busy) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (busy) return;
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className={`group flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-7 text-center transition ${
          busy ? "cursor-default" : "cursor-pointer"
        } ${
          dragging
            ? "border-violet-400/70 bg-violet-500/10"
            : "border-white/15 hover:border-violet-400/50 hover:bg-white/5"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />

        {status.kind === "done" ? (
          <CheckCircle2 className="h-6 w-6 text-emerald-400" />
        ) : busy ? (
          <Loader2 className="h-6 w-6 animate-spin text-violet-300" />
        ) : (
          <UploadCloud className="h-6 w-6 text-violet-300 transition group-hover:scale-110" />
        )}

        {busy ? (
          <div className="w-full">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-zinc-300">
                {status.kind === "uploading" ? "Uploading…" : status.progress.stage}
              </span>
              {!indeterminate && <span className="font-mono text-violet-300">{pct}%</span>}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 ${
                  indeterminate ? "w-1/3 animate-pulse" : "transition-[width] duration-200 ease-out"
                }`}
                style={indeterminate ? undefined : { width: `${pct}%` }}
              />
            </div>
          </div>
        ) : status.kind === "done" ? (
          <div className="text-sm font-medium text-emerald-300">Indexed!</div>
        ) : (
          <>
            <div className="text-sm font-medium text-zinc-200">Drop a PDF or click to upload</div>
            <div className="text-xs text-muted">Notes, textbooks, papers</div>
          </>
        )}
      </label>
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </div>
  );
}
