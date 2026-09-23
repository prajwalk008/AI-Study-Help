"use client";

import { useCallback, useRef, useState } from "react";
import { UploadCloud, Loader2, CheckCircle2, Circle, CheckCircle } from "lucide-react";
import { uploadPdf, type UploadResult, type UploadUiState, formatMb } from "@/lib/api";
import { MAX_FILE_BYTES, MAX_PART_BYTES } from "@/lib/uploadLimits";

type Status =
  | { kind: "idle" }
  | { kind: "busy"; ui: UploadUiState }
  | { kind: "done" };

export default function UploadZone({
  chatId,
  onUploaded,
  onStorageChange,
}: {
  chatId: string;
  onUploaded: (r: UploadResult) => void;
  onStorageChange?: (used: number, quota: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = status.kind === "busy";

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setError("Please choose a PDF file.");
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(`File too large (max ${MAX_FILE_BYTES / (1024 * 1024)} MB).`);
        return;
      }

      setStatus({
        kind: "busy",
        ui: {
          filename: file.name,
          fileSize: file.size,
          readDone: false,
          splitDone: false,
          totalParts: 0,
          parts: [],
          stageLabel: "Reading file from disk…",
        },
      });

      await uploadPdf(chatId, file, {
        onUi: (ui) => setStatus({ kind: "busy", ui }),
        onDone: (result, storage) => {
          setStatus({ kind: "done" });
          onStorageChange?.(storage.storageUsedBytes, storage.storageQuotaBytes);
          onUploaded(result);
          setTimeout(() => setStatus({ kind: "idle" }), 1500);
        },
        onError: (message) => {
          setError(message);
          setStatus({ kind: "idle" });
        },
      });
    },
    [chatId, onUploaded, onStorageChange]
  );

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
        className={`flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center transition ${
          busy ? "cursor-default" : "cursor-pointer"
        } ${
          dragging
            ? "border-[var(--text)] bg-[var(--surface)]"
            : "border-[var(--border)] hover:bg-[var(--surface)]"
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
          <CheckCircle2 className="h-6 w-6 text-[var(--text)]" />
        ) : busy ? (
          <Loader2 className="h-6 w-6 animate-spin text-[var(--muted)]" />
        ) : (
          <UploadCloud className="h-6 w-6 text-[var(--muted)]" />
        )}

        {status.kind === "busy" ? (
          <UploadStepper ui={status.ui} />
        ) : status.kind === "done" ? (
          <div className="text-sm font-medium text-[var(--text)]">Indexed</div>
        ) : (
          <>
            <div className="text-sm font-medium text-[var(--text)]">Drop a PDF or click to upload</div>
            <div className="text-xs text-[var(--muted)]">
              Max {MAX_FILE_BYTES / (1024 * 1024)} MB · split into {MAX_PART_BYTES / (1024 * 1024)} MB parts
            </div>
          </>
        )}
      </label>
      {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}

function UploadStepper({ ui }: { ui: UploadUiState }) {
  return (
    <div className="w-full space-y-2 text-left text-xs">
      <div className="font-medium text-[var(--text)]">
        {ui.filename} · {formatMb(ui.fileSize)}
      </div>

      <Step done={ui.readDone} label="Read file from disk" active={!ui.readDone} />
      <Step
        done={ui.splitDone}
        label={ui.splitDone ? `Split into ${ui.totalParts} parts` : "Split PDF into parts"}
        active={ui.readDone && !ui.splitDone}
      />

      {ui.parts.length > 0 && (
        <div className="mt-2 space-y-1 rounded-lg border border-[var(--border)] bg-white p-2">
          {ui.parts.map((p) => (
            <div key={p.index} className="flex items-start gap-2 text-[var(--text)]">
              <PartIcon phase={p.phase} />
              <div className="min-w-0 flex-1">
                <div>Part {p.index + 1}</div>
                {p.phase === "uploading" && <div className="text-[var(--muted)]">Uploading…</div>}
                {p.phase === "processing" && (
                  <div className="flex items-center gap-1 text-[var(--muted)]">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {p.detail || "Processing…"}
                  </div>
                )}
                {p.phase === "done" && <div className="text-[var(--muted)]">Indexed</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-[var(--muted)]">{ui.stageLabel}</div>
    </div>
  );
}

function Step({ done, label, active }: { done: boolean; label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[var(--text)]">
      {done ? (
        <CheckCircle className="h-3.5 w-3.5 shrink-0 text-[var(--text)]" />
      ) : active ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--muted)]" />
      ) : (
        <Circle className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
      )}
      <span>{label}</span>
    </div>
  );
}

function PartIcon({ phase }: { phase: string }) {
  if (phase === "done") return <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text)]" />;
  if (phase === "processing" || phase === "uploading") {
    return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[var(--muted)]" />;
  }
  return <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />;
}
