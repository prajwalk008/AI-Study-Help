"use client";

import { useState } from "react";
import { ArrowUp } from "lucide-react";

export default function Composer({
  onSend,
  disabled,
}: {
  onSend: (q: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");

  const send = () => {
    const q = value.trim();
    if (!q || disabled) return;
    onSend(q);
    setValue("");
  };

  return (
    <div className="glass flex items-end gap-2 rounded-2xl p-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        rows={1}
        placeholder="Ask anything about your documents…"
        className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder:text-muted focus:outline-none"
      />
      <button
        onClick={send}
        disabled={disabled || !value.trim()}
        className="gradient-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white disabled:cursor-not-allowed"
        aria-label="Send"
      >
        <ArrowUp className="h-4 w-4" />
      </button>
    </div>
  );
}
