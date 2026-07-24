"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, FileText, Plus, Loader2, Menu } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import LoginView from "@/components/LoginView";
import UploadZone from "@/components/UploadZone";
import ChatMessage, { type ChatMsg } from "@/components/ChatMessage";
import Composer from "@/components/Composer";
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial auth check.
  useEffect(() => {
    getMe()
      .then(async (u) => {
        setUser(u);
        if (u) setChats(await listChats());
      })
      .finally(() => setAuthLoading(false));
  }, []);

  // Load a chat's messages + documents when it becomes active.
  useEffect(() => {
    if (!activeChatId) return;
    Promise.all([getMessages(activeChatId), getChatDocuments(activeChatId)]).then(([msgs, docs]) => {
      setMessages(msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, sources: m.sources ?? undefined })));
      setDocuments(docs);
      setShowUpload(docs.length === 0);
    });
  }, [activeChatId]);

  // clears the active chat and its loaded messages/documents together
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
        content: `✅ Indexed **${r.doc_name}** — ${r.pages} page${r.pages > 1 ? "s" : ""}, ${r.chunks} chunk${r.chunks > 1 ? "s" : ""}. Ask me anything about it!`,
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
          patch((p) => ({ ...p, content: `⚠️ ${message}`, streaming: false }));
          setThinking(false);
        },
      });
    },
    [activeChatId, refreshChats]
  );

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-300" />
      </div>
    );
  }

  if (!user) return <LoginView onSignedIn={handleSignedIn} />;

  const hasDocs = documents.length > 0;

  return (
    <div className="flex h-screen">
      <button
        onClick={() => setMobileNavOpen(true)}
        className="glass fixed left-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-xl text-zinc-200 md:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-4 w-4" />
      </button>

      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        user={user}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        onSelect={selectChat}
        onNew={handleNewChat}
        onDelete={handleDeleteChat}
        onLogout={handleLogout}
      />

      <main className="flex flex-1 flex-col">
        {!activeChatId ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
            <div className="gradient-btn mb-5 flex h-14 w-14 items-center justify-center rounded-2xl">
              <Sparkles className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Start a new chat</h1>
            <p className="mt-2 max-w-sm text-sm text-muted">
              Each chat has its own books and context. Create one, upload a PDF, and ask away.
            </p>
            <button
              onClick={handleNewChat}
              className="gradient-btn mt-6 flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" /> New chat
            </button>
          </div>
        ) : (
          <>
            {/* Header: documents + add PDF */}
            <div className="flex items-center justify-between gap-3 border-b border-white/5 py-3 pl-14 pr-5 md:px-5">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {documents.map((d) => (
                  <span key={d.id} className="glass flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-zinc-300">
                    <FileText className="h-3.5 w-3.5 text-violet-300" />
                    <span className="max-w-[180px] truncate">{d.docName}</span>
                    <span className="text-muted">· p{d.pages}</span>
                  </span>
                ))}
                {documents.length === 0 && <span className="text-xs text-muted">No documents in this chat yet</span>}
              </div>
              <button
                onClick={() => setShowUpload((s) => !s)}
                className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/5"
              >
                {showUpload ? "Close" : "+ Add PDF"}
              </button>
            </div>

            {showUpload && (
              <div className="border-b border-white/5 p-4">
                <div className="mx-auto max-w-md">
                  <UploadZone chatId={activeChatId} onUploaded={onUploaded} />
                </div>
              </div>
            )}

            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl px-4 py-8">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center pt-10 text-center">
                    <div className="gradient-btn mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
                      <Sparkles className="h-6 w-6 text-white" />
                    </div>
                    <h2 className="text-xl font-semibold tracking-tight">
                      {hasDocs ? "Ask anything about your documents" : "Upload a PDF to begin"}
                    </h2>
                    <p className="mt-2 max-w-sm text-sm text-muted">
                      {hasDocs
                        ? "Answers come with citations to the exact page."
                        : "Use “+ Add PDF” above to add a book or notes to this chat."}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-6">
                    {messages.map((msg) => (
                      <ChatMessage key={msg.id} msg={msg} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-white/5 p-4">
              <div className="mx-auto max-w-3xl">
                <Composer onSend={handleSend} disabled={thinking || !hasDocs} />
                <p className="mt-2 text-center text-[11px] text-muted">
                  {hasDocs
                    ? "Answers are generated from this chat's documents · Groq Llama-3.3"
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
