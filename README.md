# 🧠 Recall — AI Study Assistant (RAG)

Upload your notes, textbooks, or research papers and ask questions in natural language.
Every answer is **generated only from your documents** and comes with **citations** pointing to
the exact page — so you can trust and verify it.

Built on a **Retrieval-Augmented Generation (RAG)** pipeline with a modern, streaming chat UI.

> Retrieval eval on a labelled test set: **Recall@3 = 1.00**, **MRR = 1.00** (`backend/eval_retrieval.py`).

---

## ✨ Features
- 📄 **Multi-PDF knowledge base** — ask questions across everything you've uploaded
- 🖼️ **Works on scanned PDFs & book photos** — automatic OCR fallback for image-only pages
- 🎯 **Citation-backed answers** — each answer cites the source doc + page, with relevance scores
- ⚡ **Token-by-token streaming** — answers type out live
- 🔍 **Semantic search** — finds meaning, not just keyword matches
- 🎨 **Modern UI** — dark, glassmorphic, animated (Next.js + Tailwind)

---

## 🏗️ Architecture

```
┌────────────────────────┐        REST / NDJSON stream        ┌──────────────────────────┐
│  Frontend (Next.js 16) │  ───────────────────────────────▶  │   Backend (FastAPI)      │
│  React 19 + Tailwind   │   /api/upload  /api/chat           │   RAG pipeline           │
│  streaming chat UI     │ ◀───────────────────────────────   │                          │
└────────────────────────┘                                    └──────────────────────────┘
                                                                          │
        PDF ──▶ 1) Extract text (PyMuPDF, per page)                          │
                   └─ OCR fallback (RapidOCR) for image-only/scanned pages   │
                2) Chunk (~380 words, 60 overlap)                         │
                3) Embed (fastembed / bge-small, ONNX)                    │
                4) Index (FAISS, cosine similarity)  ◀────────────────────┘
   Question ──▶ 5) Retrieve top-k chunks
                6) Generate grounded answer + citations (Groq · Llama 3.3)
```

### The RAG pipeline (stage by stage)
| Stage | File | What it does | Key choice |
|-------|------|--------------|------------|
| Ingest | `app/ingest.py` | PDF → text, per page (+ OCR fallback) | keep page numbers → enables citations; OCR only when text layer is empty |
| Chunk | `app/ingest.py` | sliding word window + overlap | overlap avoids losing boundary sentences |
| Embed | `app/embeddings.py` | text → 384-d vectors | fastembed (ONNX) — light, no PyTorch; asymmetric query/passage |
| Index | `app/vectorstore.py` | FAISS `IndexFlatIP` | normalized vectors → inner product == cosine |
| Retrieve | `app/rag.py` | top-k nearest chunks | k=5 balances context vs noise |
| Generate | `app/llm.py` + `app/rag.py` | grounded LLM answer | low temperature + "answer only from context" prompt |

---

## 🚀 Getting Started

### Prerequisites
- Python 3.12+, Node.js 20.9+
- A free **Groq API key** → https://console.groq.com

### 1. Backend
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# create .env from the example and paste your key
copy .env.example .env      # then edit GROQ_API_KEY
python -m uvicorn app.main:app --port 8000
```

### 2. Frontend (new terminal)
```powershell
cd frontend
npm install
npm run dev
```
Open **http://localhost:3000**, upload a PDF, and start asking questions.

### 3. (Optional) Run the retrieval evaluation
```powershell
cd backend
.\.venv\Scripts\python.exe eval_retrieval.py
```

---

## 🧪 Tech Stack
**Backend:** Python, FastAPI, fastembed (ONNX), FAISS, Groq (Llama 3.3), PyMuPDF, RapidOCR (ONNX)
**Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, lucide-react

## 📂 Structure
```
study-assistant/
├── backend/
│   ├── app/
│   │   ├── config.py         # tunable RAG knobs
│   │   ├── ingest.py         # PDF extraction + chunking (+ OCR fallback)
│   │   ├── ocr.py            # RapidOCR fallback for scanned/image-only pages
│   │   ├── embeddings.py     # fastembed wrapper (normalized vectors)
│   │   ├── vectorstore.py    # FAISS index + persistence
│   │   ├── llm.py            # Groq streaming wrapper
│   │   ├── rag.py            # the RAG engine (retrieve + prompt + generate)
│   │   └── main.py           # FastAPI endpoints
│   ├── eval_retrieval.py     # Recall@k / MRR harness
│   └── requirements.txt
└── frontend/
    └── src/
        ├── app/              # layout, page, design system
        ├── components/       # UploadZone, DocumentList, ChatMessage, Composer
        └── lib/api.ts        # typed API client + NDJSON stream parser
```

## 🔒 Notes
- `.env` (your API key) is git-ignored — never commit it.
- FAISS `IndexFlatIP` is exact search; for millions of vectors switch to an approximate
  index (IVF / HNSW) to trade a little recall for a lot of speed.
