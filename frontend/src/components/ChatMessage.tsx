"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Sparkles, User, FileText, ChevronDown } from "lucide-react";
import type { Source } from "@/lib/api";

export interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  streaming?: boolean;
}

function scoreColor(score: number) {
  if (score >= 0.6) return "text-emerald-300 bg-emerald-500/10 border-emerald-500/20";
  if (score >= 0.4) return "text-amber-300 bg-amber-500/10 border-amber-500/20";
  return "text-zinc-300 bg-white/5 border-white/10";
}

function Citations({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-medium text-violet-300 hover:text-violet-200"
      >
        <FileText className="h-3.5 w-3.5" />
        {sources.length} source{sources.length > 1 ? "s" : ""}
        <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {sources.map((s) => (
            <div key={s.n} className="glass rounded-xl p-3 text-xs">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium text-zinc-200">
                  [{s.n}] {s.doc_name} · p.{s.page}
                </span>
                <span className={`rounded-md border px-1.5 py-0.5 font-mono ${scoreColor(s.score)}`}>
                  {s.score.toFixed(3)}
                </span>
              </div>
              <p className="leading-relaxed text-muted">{s.preview}…</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChatMessage({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          isUser ? "bg-white/10 text-zinc-200" : "gradient-btn text-white"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
      </div>
      <div className={`max-w-[80%] ${isUser ? "text-right" : ""}`}>
        <div
          className={`inline-block rounded-2xl px-4 py-2.5 text-left text-sm leading-relaxed ${
            isUser ? "bg-white/10 text-zinc-100" : "glass text-zinc-100"
          }`}
        >
          {isUser ? (
            <span>{msg.content}</span>
          ) : msg.content ? (
            <div className={`prose-answer ${msg.streaming ? "caret" : ""}`}>
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          ) : (
            <span className="flex items-center gap-1 py-1">
              <span className="dot h-1.5 w-1.5 rounded-full bg-violet-300" />
              <span className="dot h-1.5 w-1.5 rounded-full bg-violet-300" />
              <span className="dot h-1.5 w-1.5 rounded-full bg-violet-300" />
            </span>
          )}
        </div>
        {!isUser && msg.sources && <Citations sources={msg.sources} />}
      </div>
    </div>
  );
}
