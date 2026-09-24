"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { FileText, ChevronDown } from "lucide-react";
import type { Source } from "@/lib/api";
import BrandLogo from "@/components/BrandLogo";

export interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  streaming?: boolean;
}

function Citations({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--text)]"
      >
        <FileText className="h-3.5 w-3.5" />
        {sources.length} source{sources.length > 1 ? "s" : ""}
        <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {sources.map((s) => (
            <div key={s.n} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium text-[var(--text)]">
                  [{s.n}] {s.doc_name} · p.{s.page}
                </span>
                <span className="font-mono text-[var(--muted)]">{s.score.toFixed(3)}</span>
              </div>
              <p className="leading-relaxed text-[var(--muted)]">{s.preview}…</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChatMessage({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-[22px] bg-[var(--surface)] px-4 py-2.5 text-[15px] leading-7 text-[var(--text)]">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-white p-0.5">
        <BrandLogo className="h-full w-full" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5 text-[15px] leading-7 text-[var(--text)]">
        {msg.content ? (
          <div className={`prose-answer ${msg.streaming ? "caret" : ""}`}>
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </div>
        ) : (
          <span className="flex items-center gap-1.5 py-2">
            <span className="dot h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
            <span className="dot h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
            <span className="dot h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
          </span>
        )}
        {msg.sources && <Citations sources={msg.sources} />}
      </div>
    </div>
  );
}
