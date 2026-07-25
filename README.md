# 🧠 Recall — AI Study Assistant (RAG)

Sign in with just your email, upload your notes/textbooks/papers into per-topic chats, and ask
questions in natural language. Every answer is **generated only from your documents** and comes
with **citations** pointing to the exact page — so you can trust and verify it.

Built on a **Retrieval-Augmented Generation (RAG)** pipeline with a streaming chat UI, email-OTP
auth, and a cloud vector database.

**Live:** https://ai-study-help-five.vercel.app *(backend free tier sleeps after 15 min idle — first message may take ~30-60s)*

> Retrieval eval on a labelled test set: **Recall@3 = 1.00**, **MRR = 1.00** (`backend/eval_retrieval.py`).

---

## ✨ Features
- 🔑 **Passwordless email-OTP login** — no passwords to manage
- 📄 **Multi-PDF knowledge base** — ask questions across everything you've uploaded, per chat
- 🖼️ **Works on scanned PDFs & book photos** — automatic OCR fallback for image-only pages
- 🎯 **Citation-backed answers** — each answer cites the source doc + page, with relevance scores
- ⚡ **Token-by-token streaming** — answers type out live
- 🔍 **Semantic search** — finds meaning, not just keyword matches, via a cloud vector database
- 📱 **Responsive** — collapsible sidebar on mobile
- 🎨 **Modern UI** — dark, glassmorphic, animated (Next.js + Tailwind)

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
   MongoDB Atlas                                    PDF ──▶ 1) Extract text (PyMuPDF, per page)
   users / sessions / otps                                     └─ OCR fallback (RapidOCR)
   chats / messages / documents                              2) Chunk (~380 words, 60 overlap)
                                                               3) Embed (fastembed / bge-small, ONNX)
                                                               4) Index (Qdrant Cloud, cosine) ◀──┐
                                                  Question ──▶ 5) Retrieve top-k chunks           │
                                                               6) Generate grounded answer         │
                                                                  + citations (Groq LLM) ──────────┘
```

Each chat's chunks live in **one shared Qdrant collection**, isolated via a `chat_id` payload
filter (Qdrant's own recommended pattern for many small tenants) rather than one collection per
chat — this also means chunks survive backend restarts/redeploys on hosts with ephemeral disk.

### The RAG pipeline (stage by stage)
| Stage | File | What it does | Key choice |
|-------|------|--------------|------------|
| Ingest | `app/ingest.py` | PDF → text, per page (+ OCR fallback) | keep page numbers → enables citations; OCR only when text layer is empty |
| Chunk | `app/ingest.py` | sliding word window + overlap | overlap avoids losing boundary sentences |
| Embed | `app/embeddings.py` | text → 384-d vectors | fastembed (ONNX) — light, no PyTorch; asymmetric query/passage |
| Index | `app/vectorstore.py` | Qdrant Cloud, shared collection | `chat_id` payload filter for isolation; L2-normalized vectors, cosine distance |
| Retrieve | `app/rag.py` | top-k nearest chunks | k=5 balances context vs noise |
| Generate | `app/llm.py` + `app/rag.py` | grounded LLM answer | low temperature + "answer only from context" prompt |

---

## 🚀 Getting Started

### Prerequisites
- Python 3.11+, Node.js 20.9+
- A free **Groq API key** → https://console.groq.com
- A free **MongoDB Atlas** cluster → https://cloud.mongodb.com
- A free **Qdrant Cloud** cluster → https://cloud.qdrant.io
- (Optional for real email) SMTP credentials — Ethereal (auto, no signup) works out of the box for dev

### 1. Backend
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env      # then fill in GROQ_API_KEY, INTERNAL_API_SECRET, QDRANT_URL, QDRANT_API_KEY
python -m uvicorn app.main:app --port 8000
```

### 2. Frontend (new terminal)
```powershell
cd frontend
npm install
# create frontend/.env.local — see CLAUDE.md for the full variable list
npm run dev
```
Open **http://localhost:3000**, sign in with your email, upload a PDF, and start asking questions.

### 3. (Optional) Run the checks
```powershell
cd backend
.\.venv\Scripts\python.exe smoke_test.py      # embed -> Qdrant -> retrieve, needs QDRANT_URL set
.\.venv\Scripts\python.exe eval_retrieval.py  # Recall@k / MRR, fully local
.\.venv\Scripts\python.exe test_ocr.py        # OCR fallback check
```

### Or start both at once
```powershell
.\start.ps1
```

---

## ☁️ Deployment
- **Frontend:** Vercel (root directory `frontend`)
- **Backend:** Render (root directory `backend`, free tier — sleeps after 15 min idle)
- **Auth/chat data:** MongoDB Atlas (free tier)
- **Vectors:** Qdrant Cloud (free tier)

See `CLAUDE.md` for the full environment variable reference for each service.

---

## 🧪 Tech Stack
**Backend:** Python, FastAPI, fastembed (ONNX), Qdrant, Groq LLM, PyMuPDF, RapidOCR (ONNX)
**Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, MongoDB driver, Nodemailer, lucide-react

## 📂 Structure
```
AI-Study-Help/
├── backend/
│   ├── app/
│   │   ├── config.py         # tunable RAG knobs + env vars
│   │   ├── ingest.py         # PDF extraction + chunking (+ OCR fallback)
│   │   ├── ocr.py            # RapidOCR fallback for scanned/image-only pages
│   │   ├── embeddings.py     # fastembed wrapper (normalized vectors)
│   │   ├── vectorstore.py    # Qdrant collection + per-chat payload filtering
│   │   ├── store_manager.py  # per-chat locks + VectorStore access
│   │   ├── llm.py            # Groq streaming wrapper
│   │   ├── rag.py            # the RAG engine (retrieve + prompt + generate)
│   │   └── main.py           # FastAPI endpoints
│   ├── smoke_test.py         # embed -> Qdrant -> retrieve sanity check
│   ├── eval_retrieval.py     # Recall@k / MRR harness
│   ├── test_ocr.py           # OCR fallback test
│   └── requirements.txt
└── frontend/
    └── src/
        ├── app/
        │   ├── page.tsx          # owns all app state
        │   └── api/              # Next.js routes = the real backend (BFF)
        │       ├── auth/         # request-otp, verify-otp, me, logout
        │       └── chats/[id]/   # chat, upload, messages, delete
        ├── components/           # Sidebar, LoginView, UploadZone, ChatMessage, Composer
        └── lib/
            ├── api.ts            # typed API client + NDJSON stream parser
            ├── mongo.ts          # cached Mongo client + index setup
            ├── otp.ts            # OTP generation/hashing
            ├── session.ts        # session token issuing/verification
            ├── mailer.ts         # Ethereal (dev) / SMTP (prod) email sending
            ├── chatauth.ts       # per-chat ownership authorization
            └── fastapi.ts        # server-side fetch to the FastAPI service
```

## 🔒 Notes
- `.env` / `.env.local` are git-ignored — never commit them.
- FastAPI has no user-level auth of its own — every request requires a shared secret header,
  and real authorization (session, chat ownership) happens entirely in the Next.js layer.
- Chats return **404, not 403** when you don't own them, so responses can't be used to guess
  which chat IDs exist.
- Qdrant `IndexFlatIP`-equivalent exact search is used via a single shared collection filtered
  by `chat_id`; at a much larger scale you'd move to an approximate index (HNSW) for speed.
