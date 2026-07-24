const BASE = (process.env.FASTAPI_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const SECRET = process.env.INTERNAL_API_SECRET || "";

/** Server-side fetch to the internal FastAPI RAG service, adding the shared secret header. */
export function fastapiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { "X-Internal-Secret": SECRET, ...(init?.headers || {}) },
  });
}
