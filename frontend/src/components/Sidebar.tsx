"use client";

import { Plus, MessageSquare, Trash2, LogOut, X, PanelLeft } from "lucide-react";
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
  const usedMb = Math.round(user.storageUsedBytes / (1024 * 1024));
  const quotaMb = Math.round(user.storageQuotaBytes / (1024 * 1024));
  const pct = Math.min(100, (user.storageUsedBytes / Math.max(user.storageQuotaBytes, 1)) * 100);

  return (
    <>
      {open && <div onClick={onClose} className="fixed inset-0 z-40 bg-black/30 md:hidden" />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[260px] shrink-0 flex-col bg-[var(--sidebar)] transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
          <button
            onClick={() => {
              onNew();
              onClose();
            }}
            className="flex flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--sidebar-hover)]"
          >
            <Plus className="h-4 w-4" />
            New chat
          </button>
          <button onClick={onClose} className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--sidebar-hover)] md:hidden" aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {chats.length === 0 ? (
            <p className="px-2 py-3 text-xs text-[var(--muted)]">No chats yet</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {chats.map((c) => (
                <li key={c.id}>
                  <div
                    className={`group flex items-center gap-1 rounded-lg px-2 py-2 text-sm ${
                      c.id === activeChatId
                        ? "bg-[var(--sidebar-active)] text-[var(--text)]"
                        : "text-[var(--text)] hover:bg-[var(--sidebar-hover)]"
                    }`}
                  >
                    <button
                      onClick={() => {
                        onSelect(c.id);
                        onClose();
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <MessageSquare className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                      <span className="truncate">{c.title}</span>
                    </button>
                    <button
                      onClick={() => onDelete(c.id)}
                      className="rounded p-1 text-[var(--muted)] opacity-0 hover:bg-white hover:text-[var(--danger)] group-hover:opacity-100"
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

        <div className="border-t border-[var(--border)] px-3 py-3">
          <div className="mb-2">
            <div className="mb-1 flex justify-between text-[11px] text-[var(--muted)]">
              <span>Storage</span>
              <span>
                {usedMb} / {quotaMb} MB
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-[var(--border)]">
              <div className="h-full rounded-full bg-[var(--text)] transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--text)] text-[11px] font-medium text-white">
                {user.email.charAt(0).toUpperCase()}
              </div>
              <span className="truncate text-xs text-[var(--muted)]" title={user.email}>
                {user.email}
              </span>
            </div>
            <button
              onClick={onLogout}
              className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--text)]"
              aria-label="Log out"
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text)] hover:bg-[var(--surface)] md:hidden"
      aria-label="Open menu"
    >
      <PanelLeft className="h-5 w-5" />
    </button>
  );
}
