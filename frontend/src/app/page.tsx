"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Plus, Loader2 } from "lucide-react";
import Sidebar, { SidebarToggle } from "@/components/Sidebar";
import LoginView from "@/components/LoginView";
import UploadZone from "@/components/UploadZone";
import ChatMessage, { type ChatMsg } from "@/components/ChatMessage";
import Composer from "@/components/Composer";
import BrandLogo from "@/components/BrandLogo";
import {
  getMe,
  listChats,
  createChat,
  deleteChat,
  getChatDocuments,
  getMessages,
  logout as apiLogout,
  streamChat,
  type User,
  type ChatSummary,
  type DocInfo,
  type Source,
  type UploadResult,
} from "@/lib/api";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocInfo[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [thinking, setThinking] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  // ChatGPT-style: sidebar open by default on desktop, closed on mobile.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("recall.sidebarOpen");
      if (saved === "0" || saved === "1") {
        setSidebarOpen(saved === "1");
        return;
      }
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      setSidebarOpen(false);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("recall.sidebarOpen", sidebarOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarOpen]);

  useEffect(() => {
    getMe()
      .then(async (u) => {
        setUser(u);
        if (u) setChats(await listChats());
      })
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!activeChatId) return;
    Promise.all([getMessages(activeChatId), getChatDocuments(activeChatId)]).then(([msgs, docs]) => {
      setMessages(msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, sources: m.sources ?? undefined })));
      setDocuments(docs);
      setShowUpload(docs.length === 0);
    });
  }, [activeChatId]);

  const selectChat = (id: string | null) => {
    setActiveChatId(id);
    if (!id) {
      setMessages([]);
      setDocuments([]);
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const refreshChats = useCallback(async () => setChats(await listChats()), []);

  const handleSignedIn = async (u: User) => {
    setUser(u);
    setChats(await listChats());
  };

  const handleNewChat = async () => {
    const chat = await createChat();
    setChats((c) => [chat, ...c]);
    setActiveChatId(chat.id);
  };

  const handleDeleteChat = async (id: string) => {
    await deleteChat(id);
    setChats((c) => c.filter((x) => x.id !== id));
    if (activeChatId === id) selectChat(null);
    const me = await getMe();
    if (me) setUser(me);
  };

  const handleLogout = async () => {
    await apiLogout();
    setUser(null);
    setChats([]);
    selectChat(null);
  };

  const onUploaded = async (r: UploadResult) => {
    if (!activeChatId) return;
    setDocuments(await getChatDocuments(activeChatId));
    setShowUpload(false);
    setMessages((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Indexed **${r.doc_name}** — ${r.pages} page${r.pages > 1 ? "s" : ""}, ${r.chunks} chunk${r.chunks > 1 ? "s" : ""}. Ask me anything about it.`,
      },
    ]);
    refreshChats();
  };

  const handleSend = useCallback(
    (question: string) => {
      if (!activeChatId) return;
      const assistantId = crypto.randomUUID();
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "user", content: question },
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ]);
      setThinking(true);
      const patch = (fn: (p: ChatMsg) => ChatMsg) =>
        setMessages((m) => m.map((msg) => (msg.id === assistantId ? fn(msg) : msg)));

      streamChat(activeChatId, question, {
        onSources: (sources: Source[]) => patch((p) => ({ ...p, sources })),
        onToken: (text: string) => patch((p) => ({ ...p, content: p.content + text })),
        onDone: () => {
          patch((p) => ({ ...p, streaming: false }));
          setThinking(false);
          refreshChats();
        },
        onError: (message: string) => {
          patch((p) => ({ ...p, content: message, streaming: false }));
          setThinking(false);
        },
      });
    },
    [activeChatId, refreshChats]
  );

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--muted)]" />
      </div>
    );
  }

  if (!user) return <LoginView onSignedIn={handleSignedIn} />;

  const hasDocs = documents.length > 0;

  return (
    <div className="flex h-screen bg-[var(--bg)]">
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        user={user}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={selectChat}
        onNew={handleNewChat}
        onDelete={handleDeleteChat}
        onLogout={handleLogout}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 md:px-4">
          {!sidebarOpen && (
            <>
              <SidebarToggle onClick={() => setSidebarOpen(true)} label="Open sidebar" />
              <button
                onClick={handleNewChat}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text)] hover:bg-[var(--surface)]"
                aria-label="New chat"
                title="New chat"
              >
                <Plus className="h-5 w-5" />
              </button>
            </>
          )}
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text)]">
            {activeChatId
              ? chats.find((c) => c.id === activeChatId)?.title || "Chat"
              : "Recall"}
          </div>
          {activeChatId && (
            <button
              onClick={() => setShowUpload((s) => !s)}
              className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface)]"
            >
              {showUpload ? "Close" : "Add PDF"}
            </button>
          )}
        </header>

        {!activeChatId ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
            <BrandLogo className="mb-5 h-11 w-auto" />
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">What can I help with?</h1>
            <p className="mt-2 max-w-sm text-sm text-[var(--muted)]">
              Create a chat, upload a PDF, and ask questions with page citations.
            </p>
            <button
              onClick={handleNewChat}
              className="mt-6 flex items-center gap-2 rounded-full bg-[var(--send)] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> New chat
            </button>
          </div>
        ) : (
          <>
            {(showUpload || documents.length > 0) && (
              <div className="border-b border-[var(--border)] px-4 py-3">
                <div className="mx-auto max-w-3xl">
                  {documents.length > 0 && (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {documents.map((d) => (
                        <span
                          key={d.id}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--text)]"
                        >
                          <FileText className="h-3.5 w-3.5 text-[var(--muted)]" />
                          <span className="max-w-[180px] truncate">{d.docName}</span>
                          <span className="text-[var(--muted)]">p{d.pages}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {showUpload && (
                    <UploadZone
                      chatId={activeChatId}
                      onUploaded={onUploaded}
                      onStorageChange={(used, quota) =>
                        setUser((u) => (u ? { ...u, storageUsedBytes: used, storageQuotaBytes: quota } : u))
                      }
                    />
                  )}
                </div>
              </div>
            )}

            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl px-4 py-6">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center pt-16 text-center">
                    <BrandLogo className="mb-4 h-10 w-auto" />
                    <h2 className="text-xl font-semibold tracking-tight text-[var(--text)]">
                      {hasDocs ? "Ask anything about your documents" : "Upload a PDF to begin"}
                    </h2>
                    <p className="mt-2 max-w-sm text-sm text-[var(--muted)]">
                      {hasDocs
                        ? "Answers include citations to the source page."
                        : "Use Add PDF above to add notes or a textbook to this chat."}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-6 pb-4">
                    {messages.map((msg) => (
                      <ChatMessage key={msg.id} msg={msg} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-4 pb-4 pt-2">
              <div className="mx-auto max-w-3xl">
                <Composer onSend={handleSend} disabled={thinking || !hasDocs} />
                <p className="mt-2 text-center text-[11px] text-[var(--muted)]">
                  {hasDocs
                    ? "Answers are based on this chat’s documents"
                    : "Add a PDF to this chat to start asking questions"}
                </p>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
