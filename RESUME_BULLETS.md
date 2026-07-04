# 📄 Resume Bullets — AI Study Assistant (RAG)

Pick 3–4. Fill in real metrics where you can (docs indexed, users, latency).

**Tech stack line:** Python, FastAPI, FAISS, fastembed, Groq (Llama 3.3), Next.js, React, TypeScript, Tailwind CSS

---

### Strong bullets
- **Built a full-stack RAG (Retrieval-Augmented Generation) study assistant** that answers
  questions from users' PDFs with **citation-backed, verifiable answers**, using FastAPI +
  Next.js and a Groq-hosted Llama 3.3 model.

- **Engineered the end-to-end retrieval pipeline** — PDF parsing with an **OCR fallback** for
  scanned/photographed pages, sliding-window chunking with overlap, ONNX embeddings
  (FAISS-indexed) and cosine-similarity top-k search — reducing LLM token usage vs.
  full-document prompting while grounding every answer in source context.

- **Wrote a retrieval-evaluation harness** measuring **Recall@k and MRR** (achieving Recall@3 =
  1.0 on a labelled set), demonstrating quantitative validation of search quality — not just
  a working demo.

- **Implemented token-level answer streaming** over an NDJSON stream (FastAPI `StreamingResponse`
  → React `ReadableStream`), and a citation UI surfacing source document, page, and relevance
  score for each answer.

- **Designed a modern, responsive chat UI** (Next.js 16, React 19, Tailwind v4) with drag-and-drop
  upload, live streaming, and glassmorphic design.

### One-liner (if space is tight)
- **AI Study Assistant (RAG):** full-stack app answering questions from user PDFs with
  citation-backed, streamed answers — FAISS vector search + Groq LLM, FastAPI + Next.js;
  validated retrieval with Recall@k/MRR.

---

### Tips
- Add a metric: *"indexed N-page textbooks"*, *"~X ms retrieval"*, *"used by N classmates"*.
- Put a **live demo link** and the **GitHub repo** next to the title — recruiters click.
- In interviews, pair this with your **Dijkstra** project: one shows GenAI/systems, the other
  shows DSA depth. Together they read as well-rounded.
