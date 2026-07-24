# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Recall** is a full-stack RAG (Retrieval-Augmented Generation) study assistant. Users upload PDFs to per-chat knowledge bases and ask questions; answers stream back with page-level citations. It uses email-OTP auth, Qdrant vector search, and Groq LLM.

Two services run concurrently:
- **Backend:** Python FastAPI on port 8000 (RAG pipeline, Qdrant, PDF ingestion)
- **Frontend:** Next.js 16 on port 3000 (UI, MongoDB, auth, Next.js API routes proxying to FastAPI)

## Commands

### Start both servers (from project root)
```powershell
.\start.ps1
```

### Backend
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

python -m uvicorn app.main:app --port 8000   # dev server
python smoke_test.py                          # sanity check (needs QDRANT_URL/QDRANT_API_KEY reachable)
python eval_retrieval.py                      # Recall@k + MRR metrics (local, no external services)
python test_ocr.py                            # OCR unit tests
```

### Frontend
```powershell
cd frontend
npm install
npm run dev        # dev server on :3000
npm run build      # production build
npm run lint       # ESLint
```

## Environment Setup

**Backend** (`backend/.env`, copied from `backend/.env.example`):
```
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-120b
EMBED_MODEL=BAAI/bge-small-en-v1.5
INTERNAL_API_SECRET=...  # must match frontend
QDRANT_URL=...           # Qdrant Cloud cluster URL
QDRANT_API_KEY=...
QDRANT_COLLECTION=chunks
```

**Frontend** (`frontend/.env.local`, not in repo):
```
MONGODB_URI=...          # MongoDB Atlas connection string
MONGODB_DB=recall
FASTAPI_URL=http://127.0.0.1:8000
INTERNAL_API_SECRET=...  # must match backend
SESSION_TTL_DAYS=30
OTP_PEPPER=...
EMAIL_FROM=Recall <no-reply@recall.app>
USE_ETHEREAL=true        # dev: auto-generates Ethereal test account
```

## Architecture

### RAG Pipeline (backend)
Six stages, each in its own module:

| Stage | File | Key detail |
|-------|------|-----------|
| Ingest | `app/ingest.py` | PyMuPDF text extraction per page; triggers OCR if text < 20 chars |
| OCR fallback | `app/ocr.py` | RapidOCR + ONNX runtime, renders at 200 DPI |
| Embed | `app/embeddings.py` | fastembed (ONNX, no PyTorch); asymmetric `query_embed()` vs `embed()` |
| Index | `app/vectorstore.py` | Qdrant Cloud (shared collection); L2-normalized vectors, cosine distance |
| Retrieve | `app/rag.py` | Top-5 chunks by cosine similarity |
| Generate | `app/llm.py` + `app/rag.py` | Groq streaming; temp=0.2 to keep answers grounded |

RAG tuning knobs live in `app/config.py`: `CHUNK_SIZE_WORDS`, `CHUNK_OVERLAP_WORDS`, `TOP_K`, `OCR_DPI`, etc.

### Multi-tenancy
Every chat's chunks live in one shared Qdrant collection (`chunks`), isolated via a `chat_id` payload filter (indexed as a keyword field for fast filtering) rather than one collection per chat — Qdrant's documented pattern for many small tenants, and a better fit for a small free-tier cluster than per-chat collection overhead. `store_manager.py` holds per-chat locks to prevent concurrent write conflicts. Deleting a chat runs a Qdrant delete-by-filter (`VectorStore.delete()`) that removes only that chat's points.

### Streaming (NDJSON)
Both upload and chat endpoints yield newline-delimited JSON events:
- Upload: `{type:"progress", stage, pct}` → `{type:"done", stats}`
- Chat: `{type:"sources", sources:[]}` → `{type:"token", text}` (per token) → `{type:"done"}`

The Next.js route for chat (`/api/chats/[id]/chat/route.ts`) side-streams these: it forwards tokens to the browser while simultaneously accumulating the full answer to persist to MongoDB once generation is complete.

### Frontend: Next.js API routes as BFF
All FastAPI calls go through Next.js API routes (`frontend/src/app/api/`), which:
1. Validate the session cookie and chat ownership (`lib/chatauth.ts → requireOwnedChat()`)
2. Add the shared `X-Internal-Secret` header before forwarding (`lib/fastapi.ts`)

FastAPI itself has no user-level auth — it trusts the secret header and assumes Next.js has already authorized the request.

### Auth (Email-OTP)
- `lib/otp.ts`: 6-digit code, HMAC-SHA256 hashed with `OTP_PEPPER`, 10-min TTL, max 5 attempts, 30s resend cooldown
- `lib/session.ts`: 32-byte random token, stored as hash; set as httpOnly cookie
- MongoDB TTL indexes auto-expire OTPs and sessions — no cron needed
- Dev mode: leave SMTP unset → Ethereal test account; printed preview URL returned in response

### MongoDB collections
`users`, `sessions`, `otps`, `chats`, `messages`, `documents`. Indexes are created automatically on first run by `lib/mongo.ts:ensureIndexes()`. No migration files — schema is enforced by application code.

### Frontend component tree
`page.tsx` owns all state (`user`, `chats`, `activeChatId`, `messages`, `documents`). Children are: `Sidebar`, `UploadZone`, `ChatMessage`, `Composer`, `LoginView`. `lib/api.ts` is the typed API client used by all components.

## Key Design Decisions

- **Shared Qdrant collection with chat_id payload filtering**: avoids per-collection overhead of one collection per chat, at the cost of every query/delete needing to carry the filter — a missing filter would leak across chats, so `store_manager.py` always scopes access through `VectorStore(chat_id)`
- **fastembed over sentence-transformers**: ONNX runtime, ~10× lighter, no PyTorch dependency
- **Qdrant Cloud over local FAISS**: survives backend restarts/redeploys on hosts with ephemeral disk (e.g. free-tier PaaS), at the cost of a network round-trip per query instead of in-process search
- **404 not 403 for unauthorized chats**: Doesn't leak resource existence to non-owners
- **Overlap chunking (60 words)**: Prevents losing sentences at chunk boundaries

## Important Notes

- Next.js 16 changed several API conventions from v15 — see `frontend/AGENTS.md` for specifics (e.g., `params` is now async in route handlers).
- The backend requires the venv to be activated before running any Python commands.
- `backend/data/uploads/` is git-ignored but must exist; a `.gitkeep` file preserves the directory. It only ever holds a PDF transiently during upload — it's deleted immediately after ingestion, so it's fine on ephemeral disk. Vector storage itself lives in Qdrant Cloud, not on local disk.
