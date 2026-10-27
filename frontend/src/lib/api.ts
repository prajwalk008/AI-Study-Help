// All requests are same-origin to Next.js route handlers (which proxy to FastAPI server-side).

export interface User {
  id: string;
  email: string;
  storageQuotaBytes: number;
  storageUsedBytes: number;
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

export type PartPhase = "pending" | "uploading" | "uploaded" | "processing" | "done" | "error";

export interface UploadPartState {
  index: number;
  phase: PartPhase;
  detail?: string;
}

export interface UploadUiState {
  filename: string;
  fileSize: number;
  readDone: boolean;
  splitDone: boolean;
  totalParts: number;
  parts: UploadPartState[];
  stageLabel: string;
}

export interface UploadResult {
  doc_name: string;
  chunks: number;
  pages: number;
}

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || `Request failed (${res.status})`);
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

const STATUS_POLL_MS = 1500;

function formatMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function releaseQuota(uploadId: string) {
  await fetch("/api/quota/release", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId }),
  }).catch(() => {});
}

async function uploadPart(chatId: string, form: FormData): Promise<{ docId: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(`/api/chats/${chatId}/upload/segment`, {
        method: "POST", body: form,
      });
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    const body = await response.json().catch(() => ({}));
    if (response.ok) return body as { docId: string };
    if (response.status < 500 || attempt === 2) {
      throw new Error(body.error || "Part upload failed.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error("Part upload failed.");
}

async function pollUntilDocumentDone(
  chatId: string,
  docId: string,
  totalParts: number,
  onProgress: (completed: number, detail: string) => void
): Promise<UploadResult> {
  for (;;) {
    const res = await fetch(`/api/chats/${chatId}/upload/status?docId=${encodeURIComponent(docId)}`);
    const job = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(job.error || "Status check failed");
    if (job.status === "error") throw new Error(job.error || "Failed to ingest PDF.");
    onProgress(Math.min(job.completed_segments ?? 0, totalParts), job.stage || "Queued");
    if (job.status === "done" && job.stats) return job.stats as UploadResult;
    await new Promise((r) => setTimeout(r, STATUS_POLL_MS));
  }
}

export async function uploadPdf(
  chatId: string,
  file: File,
  handlers: {
    onUi: (state: UploadUiState) => void;
    onDone: (r: UploadResult, storage: { storageUsedBytes: number; storageQuotaBytes: number }) => void;
    onError: (message: string) => void;
  }
): Promise<void> {
  const uploadId = crypto.randomUUID();
  let docId = "";
  let submissionAttempted = false;

  const patch = (partial: Partial<UploadUiState> & { parts?: UploadPartState[] }) => {
    handlers.onUi({ ...ui, ...partial, parts: partial.parts ?? ui.parts });
  };

  let ui: UploadUiState = {
    filename: file.name,
    fileSize: file.size,
    readDone: false,
    splitDone: false,
    totalParts: 0,
    parts: [],
    stageLabel: "Reading file from disk…",
  };
  handlers.onUi(ui);

  try {
    const { splitPdfIntoParts } = await import("./pdfSplit");
    const { MAX_FILE_BYTES } = await import("./uploadLimits");

    if (file.size > MAX_FILE_BYTES) {
      throw new Error(`File too large (max ${MAX_FILE_BYTES / (1024 * 1024)} MB).`);
    }

    ui = { ...ui, readDone: true, stageLabel: "Splitting PDF into parts…" };
    handlers.onUi(ui);

    const parts = await splitPdfIntoParts(file);
    if (parts.length === 0) throw new Error("PDF has no pages.");

    const partStates: UploadPartState[] = parts.map((p) => ({
      index: p.partIndex,
      phase: "pending",
    }));
    ui = {
      ...ui,
      splitDone: true,
      totalParts: parts.length,
      parts: partStates,
      stageLabel: `Split into ${parts.length} part${parts.length === 1 ? "" : "s"}`,
    };
    handlers.onUi(ui);

    const reserveRes = await fetch("/api/quota/reserve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId,
        filename: file.name,
        fileSize: file.size,
        uploadId,
      }),
    });
    const reserveBody = await reserveRes.json().catch(() => ({}));
    if (!reserveRes.ok) throw new Error(reserveBody.error || "Could not reserve storage.");

    let storage = {
      storageUsedBytes: reserveBody.storageUsedBytes as number,
      storageQuotaBytes: reserveBody.storageQuotaBytes as number,
    };

    const totalPages = parts.reduce((n, p) => n + p.pageCount, 0);

    for (const part of parts) {
      partStates[part.partIndex] = { index: part.partIndex, phase: "uploading" };
      patch({
        stageLabel: `Uploading part ${part.partIndex + 1} of ${parts.length}`,
        parts: [...partStates],
      });

      const form = new FormData();
      form.append("uploadId", uploadId);
      form.append("filename", file.name);
      form.append("segmentIndex", String(part.partIndex));
      form.append("totalSegments", String(parts.length));
      form.append("pageOffset", String(part.pageOffset));
      form.append("totalPages", String(totalPages));
      if (docId) form.append("docId", docId);
      form.append("file", part.blob, `${file.name}.part${part.partIndex + 1}.pdf`);

      if (part.partIndex + 1 === parts.length) submissionAttempted = true;
      const segBody = await uploadPart(chatId, form);
      docId = segBody.docId;
      partStates[part.partIndex] = { index: part.partIndex, phase: "uploaded" };
      patch({
        stageLabel: `Uploaded part ${part.partIndex + 1} of ${parts.length}`,
        parts: [...partStates],
      });
    }

    const stats = await pollUntilDocumentDone(chatId, docId, parts.length, (completed, detail) => {
      for (let index = 0; index < parts.length; index++) {
        partStates[index] = {
          index,
          phase: index < completed ? "done" : index === completed ? "processing" : "uploaded",
          detail: index === completed ? detail : undefined,
        };
      }
      patch({ stageLabel: detail, parts: [...partStates] });
    });

    const me = await getMe();
    if (me) {
      storage = {
        storageUsedBytes: me.storageUsedBytes,
        storageQuotaBytes: me.storageQuotaBytes,
      };
    }

    patch({ stageLabel: `Indexed — ${stats.pages} pages · ${stats.chunks} chunks` });
    handlers.onDone(stats, storage);
  } catch (e) {
    if (!submissionAttempted) await releaseQuota(uploadId);
    handlers.onError(e instanceof Error ? e.message : "Upload failed");
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

export { formatMb };
