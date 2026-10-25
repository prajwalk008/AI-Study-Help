# 🧠 Recall — AI Study Assistant (RAG)

Sign in with an email verification code, upload PDFs into chats, and ask questions in natural
language. Recall retrieves passages from the PDFs and asks the model to answer from them. It shows
the retrieved document names, page labels, scores, and previews so you can check the answer against
the source. The model's claims and inline citations are not independently verified.

Built on a **Retrieval-Augmented Generation (RAG)** pipeline with a streaming chat UI, email-OTP
auth, and Qdrant vector search.



**Live:** https://recall.theprajwal.tech 


`backend/eval_retrieval.py` computes Recall@3 and MRR on six hand-written passage/question pairs
using local embeddings. It does not evaluate PDF extraction, Qdrant search, or generated answers.

---

## ✨ Features
- 🔑 **Passwordless email-OTP login** — no passwords to manage
- 🔒 **Encryption at rest** — passage text and file names in Qdrant, and questions, answers, titles, file names, and emails in Mongo, are stored as AES-256-GCM ciphertext
- 📄 **Multi-PDF knowledge base** — ask questions across everything you've uploaded, per chat
- 🖼️ **Scanned PDF support** — OCR is attempted when a PDF page has fewer than 20 extracted text characters; standalone image uploads are not supported
- 🎯 **Source context** — retrieved passages are shown with document names, page labels, relevance scores, and previews; the prompt requests inline citations, but the app does not validate them
- 📝 **Grounding prompt** — asks the model to use retrieved passages; there is currently no implemented web-search fallback or guarantee against unsupported answers
- ✍️ **Rich markdown answers** — tables, code blocks, and lists render properly (`react-markdown` + GFM), not raw text
- ⚡ **Token-by-token streaming** — answers type out live
- 🔍 **Semantic search** — finds meaning, not just keyword matches, via a cloud vector database
- 📦 **PDF uploads from the browser** — files up to 50 MiB are split by page into parts of at most 4 MiB (`pdf-lib`) and uploaded sequentially; a single page over 4 MiB must be compressed first
- 📊 **Per-user storage quota** — 100 MiB per user by default; Mongo atomically reserves space for uploads, and cleanup releases it on failure or deletion
- 📱 **Responsive** — sidebar collapses on mobile *and* can be toggled closed on desktop
- 🎨 **Responsive light UI** — Next.js + Tailwind, with custom branding and animated loading states
- 🐳 **Dockerized** — `docker-compose up --build` starts both services after their environment files are configured

---

## 🏗️ Architecture

```
┌───────────────────────────┐     REST / NDJSON stream    ┌──────────────────────────┐
│  Frontend (Next.js 16)    │ ───────────────────────────▶│   Backend (FastAPI)      │
│  React 19 + Tailwind      │  X-Internal-Secret header    │   RAG pipeline           │
│  API routes = BFF layer   │◀───────────────────────────  │   (no user auth of its   │
│  owns auth + Mongo access │                               │    own — trusts Next.js) │
└──────────┬─────────────────┘                              └─────────────┬────────────┘
           │                                                              │
           ▼                                                              │
   MongoDB                                          PDF ──▶ 1) Extract text (PyMuPDF, per page)
   users / sessions / otps                                     └─ OCR fallback (RapidOCR)
   chats / messages / documents                              2) Chunk (~380 words, 60 overlap)
                                                               3) Embed (fastembed / bge-small, ONNX)
                                                               4) Index (Qdrant, cosine) ◀────────┐
                                                  Question ──▶ 5) Retrieve top-k chunks           │
                                                               6) Ask Groq to answer from context │
                                                                  and cite passages ───────────────┘
```

Each chat's chunks live in **one shared Qdrant collection**, isolated via a `chat_id` payload
filter rather than one collection per chat. Qdrant persists the chunks across backend restarts and
redeploys even when the backend has ephemeral disk. The Next.js layer checks chat ownership before
calling the internal FastAPI service.

### The RAG pipeline (stage by stage)
| Stage | File | What it does | Key choice |
|-------|------|--------------|------------|
| Ingest | `app/ingest.py` | PDF → text, per page (+ OCR fallback) | page labels are retained; OCR is attempted below 20 extracted characters |
| Chunk | `app/ingest.py` | 380-word windows with 60-word overlap | also carries up to 120 words from the previous page, so a chunk's page label can include preceding-page text |
| Embed | `app/embeddings.py` | text → 384-d vectors | fastembed (ONNX) — light, no PyTorch; asymmetric query/passage |
| Index | `app/vectorstore.py` | Qdrant, shared collection | `chat_id` payload filter for isolation; L2-normalized vectors, cosine distance |
| Retrieve | `app/rag.py` | top-k nearest chunks | k=5 by default; no relevance threshold or reranker |
| Generate | `app/llm.py` + `app/rag.py` | stream a Groq answer | temperature 0.2; prompt requests grounding and inline citations, but neither is enforced |

---

## 🔒 Encryption at rest

The app encrypts selected Mongo fields and Qdrant payload fields before saving them. A database
dump or Qdrant API key alone cannot decrypt those fields without the separate application keys.
Metadata and Qdrant vectors remain readable to the database service.

The app still handles readable text during a request. FastAPI reads the PDF, creates embeddings,
and sends the question plus retrieved passages to Groq. The encrypted fields are saved to the
databases; the browser receives readable responses. Configure HTTPS for every deployed service
connection.

Two keys, one per service. Next.js is the only process that talks to Mongo, so it alone holds `MONGO_FIELD_KEY`. FastAPI is the only process that talks to Qdrant, so it alone holds `QDRANT_PAYLOAD_KEY`. Each key is 32 random bytes, base64, in that service's environment. It is never written into the Docker image or into git. Losing a key makes the values it locked unreadable.

| Store | Locked | Left readable, and why |
|-------|--------|------------------------|
| Qdrant payload | passage `text`, `doc_name` | the 384 search numbers (cosine search needs the real floats); `chat_id` (per-chat filter); `doc_id` and `page` (ids, not the writing) |
| `messages` | `content` (question and answer), `sources` (citation list, including the short quote) | `role`, `status`, `chatId`, `userId`, `createdAt` |
| `chats` | `title` | `userId`, `createdAt`, `updatedAt` |
| `documents` | `docName` | `status`, `sizeBytes`, `chunks`, `pages`, and the ids used to find the row |
| `users` | `email` | `emailLookup` (HMAC fingerprint used to find the account), quota numbers, `verified`, `createdAt` |
| `otps` | `email` | `codeHash` (the 6-digit code is never stored), `attempts`, `expiresAt` |
| `sessions` | — | `tokenHash` is already a SHA-256 fingerprint of the cookie, not the cookie itself |

The cipher is AES-256-GCM. Every value gets a fresh 12-byte random starter and a 16-byte tag, stored as one string:

```text
v1.<starter>.<ciphertext>.<tag>
```

A stamp is bound to each value (collection, field, and record id, and the chat id for Qdrant). A ciphertext copied onto another chat or user fails to open. Values with no `v1.` prefix are older plain text and are returned as-is, so rows saved before this change still load.

Email cannot be found if it is locked with a random starter, so login stores `emailLookup = HMAC-SHA256(MONGO_FIELD_KEY, normalized email)` and searches on that. The address itself is the locked `email` field. The first successful login of an old account rewrites that row into the locked form.

| Step | Where |
|------|--------|
| Lock and unlock Qdrant text | `backend/app/fieldcipher.py`, called from `backend/app/vectorstore.py` on save and after search |
| Lock and unlock Mongo fields | `frontend/src/lib/fieldcipher.ts`, called from the chat, message, document, and auth routes |
| Unlock a chat title for the "New chat" check | `frontend/src/lib/chatauth.ts` (the database copy stays locked) |
| Unlock the signed-in user's email | `frontend/src/lib/session.ts` |

Generate the two keys separately. Use the same `QDRANT_PAYLOAD_KEY` everywhere that backend runs, and the same `MONGO_FIELD_KEY` everywhere the website runs (local `.env.local` and Vercel).

```powershell
python -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put the first value in `backend/.env` as `QDRANT_PAYLOAD_KEY`, and the second in `frontend/.env.local` as `MONGO_FIELD_KEY`.

---

## 🚀 Getting Started

### Prerequisites
- Python 3.11+, Node.js 20.9+
- A **Groq API key** → https://console.groq.com
- A **MongoDB** connection (for example, MongoDB Atlas) → https://cloud.mongodb.com
- A **Qdrant** instance (for example, Qdrant Cloud) → https://cloud.qdrant.io
- SMTP credentials for delivered OTP email, or `USE_ETHEREAL=true` for a local test-inbox preview

Create `backend/.env` from `backend/.env.example` and create `frontend/.env.local` with these
settings. Keep the same `INTERNAL_API_SECRET` in both files; generate both encryption keys
separately as shown above.

| Service | Setting | Purpose |
|---------|---------|---------|
| Backend | `GROQ_API_KEY` | Generate streamed answers |
| Backend | `QDRANT_URL`, `QDRANT_API_KEY` | Store and search PDF chunks |
| Backend | `QDRANT_PAYLOAD_KEY` | Encrypt Qdrant passage text and document names |
| Both | `INTERNAL_API_SECRET` | Authenticate Next.js requests to FastAPI |
| Frontend | `MONGODB_URI` | Store users, sessions, chats, messages, and document records |
| Frontend | `MONGO_FIELD_KEY` | Encrypt selected Mongo fields and derive email lookup fingerprints |
| Frontend | `FASTAPI_URL` | Internal FastAPI URL; defaults to `http://127.0.0.1:8000` locally |
| Frontend | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Send real OTP email; alternatively set `USE_ETHEREAL=true` for preview-only development mail |

Optional settings: backend `GROQ_MODEL`, `EMBED_MODEL`, `QDRANT_COLLECTION`,
`MAX_CONCURRENT_INGESTS`, and `INGEST_BATCH_SIZE`; frontend `MONGODB_DB`, `OTP_PEPPER`,
`EMAIL_FROM`, and `SESSION_TTL_DAYS`. Set a random `OTP_PEPPER` for deployed instances.

### 1. Backend
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env      # then fill in the backend settings in the table above
python -m uvicorn app.main:app --port 8000
```

### 2. Frontend (new terminal)
```powershell
cd frontend
npm install
# create .env.local with the frontend settings in the table above
# use the same INTERNAL_API_SECRET as backend/.env
npm run dev
```
Open **http://localhost:3000**, sign in with your email code, upload a PDF, and start asking questions.
With `USE_ETHEREAL=true`, the OTP response contains a preview URL instead of delivering mail.

### 3. (Optional) Run the checks
```powershell
cd backend
.\.venv\Scripts\python.exe smoke_test.py      # embed -> Qdrant -> retrieve; needs Qdrant URL, API key, and payload key
.\.venv\Scripts\python.exe eval_retrieval.py  # six-example Recall@3 / MRR check; model may download on first run
.\.venv\Scripts\python.exe test_page_tail.py  # page-tail chunking check
.\.venv\Scripts\python.exe test_ocr.py        # OCR fallback check; also needs Pillow installed
```

### Or start both at once
```powershell
.\start.ps1
```

### Or run it all with Docker
```powershell
docker-compose up --build
```
Builds and runs both services (`backend/Dockerfile`, `frontend/Dockerfile`) using `backend/.env` and
`frontend/.env.local` — frontend on `:3000`, backend on `:8000`, with a named volume for temporary
upload files. Indexed chunks are stored in Qdrant.

---

## ☁️ Deployment
The README's documented hosting layout is below. Confirm the active deployment and demo URL in
the hosting dashboards; application source code alone does not establish their current status.

- **Frontend:** Vercel (root directory `frontend`)
- **Backend:** Render (root directory `backend`)
- **Auth/chat data:** MongoDB Atlas
- **Vectors:** Qdrant Cloud
- **Or self-host either service** from its Dockerfile — see `docker-compose.yml`

Configure the variables in the Getting Started table for each deployed service. Hosting plans,
limits, and idle behavior depend on the current provider configuration.

---

## 🧪 Tech Stack
**Backend:** Python, FastAPI, fastembed (ONNX), Qdrant, Groq LLM, PyMuPDF, RapidOCR (ONNX), cryptography (AES-256-GCM)
**Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, MongoDB driver, Nodemailer, lucide-react, react-markdown, pdf-lib

## 📂 Structure
```
AI-Study-Help/
├── docker-compose.yml     # runs backend + frontend together
├── backend/
│   ├── Dockerfile
│   ├── app/
│   │   ├── config.py         # tunable RAG knobs + env vars
│   │   ├── ingest.py         # PDF extraction + chunking (+ OCR fallback, page-tail carry-over)
│   │   ├── jobs.py           # background job tracking for async/segmented uploads
│   │   ├── ocr.py            # RapidOCR fallback for scanned/image-only pages
│   │   ├── embeddings.py     # fastembed wrapper (normalized vectors)
│   │   ├── fieldcipher.py    # AES-256-GCM for Qdrant passage text and file names
│   │   ├── vectorstore.py    # Qdrant collection + per-chat payload filtering
│   │   ├── store_manager.py  # per-chat locks + VectorStore access
│   │   ├── llm.py            # Groq streaming wrapper
│   │   ├── rag.py            # the RAG engine (retrieve + build the model prompt)
│   │   └── main.py           # FastAPI endpoints (incl. segmented PDF upload)
│   ├── smoke_test.py         # embed -> Qdrant -> retrieve sanity check
│   ├── eval_retrieval.py     # Recall@k / MRR harness
│   ├── test_ocr.py           # OCR fallback test
│   ├── test_page_tail.py     # page-tail chunk carry-over test
│   └── requirements.txt
└── frontend/
    ├── Dockerfile
    └── src/
        ├── app/
        │   ├── page.tsx          # owns all app state
        │   └── api/              # Next.js routes for auth, data, and FastAPI proxying (BFF)
        │       ├── auth/         # request-otp, verify-otp, me, logout
        │       ├── quota/        # reserve/release storage quota
        │       └── chats/[id]/   # chat, messages, delete, upload/segment, upload/status
        ├── components/           # Sidebar (collapsible), LoginView, UploadZone, ChatMessage
        │                         # (markdown rendering), Composer, BrandLogo
        └── lib/
            ├── api.ts            # typed API client + NDJSON stream parser
            ├── mongo.ts          # cached Mongo client + index setup
            ├── otp.ts            # OTP generation/hashing
            ├── session.ts        # session token issuing/verification
            ├── mailer.ts         # Ethereal (dev) / SMTP (prod) email sending
            ├── chatauth.ts       # per-chat ownership authorization
            ├── fastapi.ts        # server-side fetch to the FastAPI service
            ├── fieldcipher.ts     # AES-256-GCM for Mongo fields + email fingerprint
            ├── pdfSplit.ts       # client-side PDF splitting into upload-sized parts
            ├── quota.ts          # atomic per-user storage reservation and cleanup (Mongo)
            └── uploadLimits.ts   # shared size/quota constants
```

## 🔒 Notes
- `.env` / `.env.local` are git-ignored — never commit them. That includes `QDRANT_PAYLOAD_KEY` and `MONGO_FIELD_KEY`. A lost key cannot be recovered from the database.
- FastAPI has no user-level auth of its own. Its RAG and upload endpoints require a shared secret
  header; `/api/health` is public. Session and chat-ownership checks happen in the Next.js layer.
- Chats return **404, not 403** when you don't own them, so responses can't be used to guess
  which chat IDs exist.
- Qdrant searches the shared cosine-distance collection with a `chat_id` filter. The code does not
  request exact search; Qdrant may use [HNSW or a full scan](https://qdrant.tech/documentation/manage-data/indexing/)
  according to its index and query planner.
- Storage quota is enforced with an atomic Mongo `findOneAndUpdate` (`frontend/src/lib/quota.ts`)
  so concurrent reservations cannot exceed the per-user limit. Stale `processing` documents are
  checked and their reserved space released when a quota operation calls `migrateUserQuotas()`;
  there is no scheduled sweeper.
- The backend keeps upload job status in memory (`backend/app/jobs.py`) and runs ingestion in daemon
  threads. A backend restart can lose an in-progress job, although indexed chunks already written
  to Qdrant remain there.
- PDFs are split into page-based parts of at most 4 MiB in the browser (`pdfSplit.ts`) and uploaded
  one part at a time. The file limit is 50 MiB; a page that cannot fit in one part is rejected.
  Each part starts with a page-count estimate based on the source file's average bytes per page and
  a 3,600 KiB (about 3.5 MiB) target. If the generated part exceeds 4 MiB, the splitter halves
  that part's page range until it fits. The next part starts from the original estimate, so an
  unusually large range does not force every later part to stay small. FastAPI processes each part
  before the browser uploads the next; it does not reassemble the original PDF.
- There is no web-search tool wired to the Groq call. The prompt mentions web search, but the app
  cannot perform one; retrieved sources and generated citations should be checked by the reader.
