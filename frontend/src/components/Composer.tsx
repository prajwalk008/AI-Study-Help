"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";

export default function Composer({
  onSend,
  disabled,
}: {
  onSend: (q: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const send = () => {
    const q = value.trim();
    if (!q || disabled) return;
    onSend(q);
    setValue("");
  };

  return (
    <div className="rounded-[28px] border border-[var(--composer-border)] bg-[var(--composer)] shadow-[0_0_0_0_transparent] focus-within:border-[#b4b4b4]">
      <div className="flex items-end gap-2 px-3 py-2.5">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder={disabled ? "Upload a PDF to start asking…" : "Ask anything"}
          disabled={disabled}
          className="max-h-40 min-h-[28px] flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] leading-6 text-[var(--text)] outline-none placeholder:text-[var(--muted)] disabled:cursor-not-allowed"
        />
        <button
          onClick={send}
          disabled={disabled || !value.trim()}
          className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--send)] text-white disabled:cursor-not-allowed disabled:bg-[#d9d9d9]"
          aria-label="Send"
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
