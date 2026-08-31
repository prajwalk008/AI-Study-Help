"use client";

import { BrainCircuit, Plus, MessageSquare, Trash2, LogOut, X } from "lucide-react";
import type { ChatSummary, User } from "@/lib/api";

export default function Sidebar({
  chats,
  activeChatId,
  user,
  open,
  onClose,
  onSelect,
  onNew,
  onDelete,
  onLogout,
}: {
  chats: ChatSummary[];
  activeChatId: string | null;
  user: User;
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
}) {
  return (
    <>
      {open && <div onClick={onClose} className="fixed inset-0 z-40 bg-black/50 md:hidden" />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 shrink-0 flex-col border-r border-white/5 bg-[var(--bg-soft)] p-4 transition-transform duration-200 md:static md:z-auto md:flex md:translate-x-0 md:bg-transparent ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-4 flex items-center justify-between gap-2.5 px-1">
          <div className="flex items-center gap-2.5">
            <div className="gradient-btn flex h-9 w-9 items-center justify-center rounded-xl">
              <BrainCircuit className="h-5 w-5 text-white" />
            </div>
            <div className="text-lg font-semibold tracking-tight">
              Re<span className="gradient-text">call</span>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-zinc-200 md:hidden" aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <button
          onClick={() => {
            onNew();
            onClose();
          }}
          className="gradient-btn mb-4 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" /> New chat
        </button>

        <div className="flex-1 overflow-y-auto">
          {chats.length === 0 ? (
            <p className="px-2 text-xs text-muted">No chats yet. Start one above.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {chats.map((c) => (
                <li key={c.id}>
                  <div
                    className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${
                      c.id === activeChatId ? "glass text-zinc-100" : "text-zinc-300 hover:bg-white/5"
                    }`}
                  >
                    <button
                      onClick={() => {
                        onSelect(c.id);
                        onClose();
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <MessageSquare className="h-4 w-4 shrink-0 text-muted" />
                      <span className="truncate">{c.title}</span>
                    </button>
                    <button
                      onClick={() => onDelete(c.id)}
                      className="opacity-0 transition group-hover:opacity-100 hover:text-rose-400"
                      aria-label="Delete chat"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
          <div className="px-1">
            <div className="mb-1 flex justify-between text-[10px] text-muted">
              <span>Storage</span>
              <span>
                {Math.round(user.storageUsedBytes / (1024 * 1024))} /{" "}
                {Math.round(user.storageQuotaBytes / (1024 * 1024))} MB
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-violet-500 transition-all"
                style={{
                  width: `${Math.min(100, (user.storageUsedBytes / Math.max(user.storageQuotaBytes, 1)) * 100)}%`,
                }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate px-1 text-xs text-muted" title={user.email}>
              {user.email}
            </span>
            <button onClick={onLogout} className="flex items-center gap-1 text-xs text-muted hover:text-zinc-200" aria-label="Log out">
              <LogOut className="h-3.5 w-3.5" /> Logout
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
