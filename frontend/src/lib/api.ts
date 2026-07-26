// All requests are same-origin to Next.js route handlers (which proxy to FastAPI server-side).

export interface User {
  id: string;
  email: string;
}

export interface Source {
  n: number;
  doc_name: string;
  page: number;
  score: number;
  preview: string;
}

export interface DocInfo {
  id: string;
  docName: string;
  chunks: number;
  pages: number;
  status: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[] | null;
  status?: string;
}

export interface UploadProgress {
  stage: string;
  pct: number;
}

export interface UploadResult {
  doc_name: string;
  chunks: number;
  pages: number;
}

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---- Auth ----
export async function requestOtp(email: string): Promise<{ previewUrl: string | null }> {
  const res = await fetch("/api/auth/request-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return parseJson(res);
}

export async function verifyOtp(email: string, code: string): Promise<{ user: User }> {
  const res = await fetch("/api/auth/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  return parseJson(res);
}

export async function getMe(): Promise<User | null> {
  const res = await fetch("/api/auth/me");
  if (res.status === 401) return null;
  const data = await parseJson(res);
  return data.user as User;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

// ---- Chats ----
export async function listChats(): Promise<ChatSummary[]> {
  const data = await parseJson(await fetch("/api/chats"));
  return data.chats;
}

export async function createChat(): Promise<ChatSummary> {
  const data = await parseJson(await fetch("/api/chats", { method: "POST" }));
  return data.chat;
}

export async function deleteChat(id: string): Promise<void> {
  await parseJson(await fetch(`/api/chats/${id}`, { method: "DELETE" }));
}

export async function getChatDocuments(id: string): Promise<DocInfo[]> {
  const data = await parseJson(await fetch(`/api/chats/${id}`));
  return data.documents;
}

export async function getMessages(id: string): Promise<Message[]> {
  const data = await parseJson(await fetch(`/api/chats/${id}/messages`));
  return data.messages;
}

// ---- Streaming helpers ----
async function readNdjson(res: Response, onEvent: (evt: Record<string, unknown>) => void) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line));
    }
  }
}

const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

async function postChunkWithRetry(chatId: string, form: FormData): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`/api/chats/${chatId}/upload/chunk`, { method: "POST", body: form });
    if (res.ok) return;
    if (attempt >= 2) {
      const err = await res.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(err.error || "Upload failed");
    }
  }
}

export async function uploadPdf(
  chatId: string,
  file: File,
  handlers: {
    onProgress: (p: UploadProgress) => void;
    onDone: (r: UploadResult) => void;
    onError: (message: string) => void;
  }
): Promise<void> {
  try {
    const uploadId = crypto.randomUUID();
    const total = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK_BYTES));

    for (let index = 0; index < total; index++) {
      const slice = file.slice(index * UPLOAD_CHUNK_BYTES, (index + 1) * UPLOAD_CHUNK_BYTES);
      const form = new FormData();
      form.append("uploadId", uploadId);
      form.append("index", String(index));
      form.append("total", String(total));
      form.append("chunk", slice, file.name);
      await postChunkWithRetry(chatId, form);
      handlers.onProgress({ stage: "Uploading", pct: (index + 1) / total });
    }

    const res = await fetch(`/api/chats/${chatId}/upload/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId, filename: file.name, total }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: "Upload failed" }));
      handlers.onError(err.error || "Upload failed");
      return;
    }
    await readNdjson(res, (evt) => {
      if (evt.type === "progress") handlers.onProgress({ stage: evt.stage as string, pct: evt.pct as number });
      else if (evt.type === "done") handlers.onDone(evt.stats as UploadResult);
      else if (evt.type === "error") handlers.onError(evt.detail as string);
    });
  } catch (e) {
    handlers.onError(e instanceof Error ? e.message : "Network error");
  }
}

export async function streamChat(
  chatId: string,
  question: string,
  handlers: {
    onSources: (sources: Source[]) => void;
    onToken: (text: string) => void;
    onDone: () => void;
    onError: (message: string) => void;
  }
): Promise<void> {
  try {
    const res = await fetch(`/api/chats/${chatId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: "Request failed" }));
      handlers.onError(err.error || "Request failed");
      return;
    }
    await readNdjson(res, (evt) => {
      if (evt.type === "sources") handlers.onSources(evt.sources as Source[]);
      else if (evt.type === "token") handlers.onToken(evt.text as string);
      else if (evt.type === "done") handlers.onDone();
    });
  } catch (e) {
    handlers.onError(e instanceof Error ? e.message : "Network error");
  }
}
