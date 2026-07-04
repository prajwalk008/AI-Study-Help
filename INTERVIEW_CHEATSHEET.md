# 🎯 Interview Cheat-Sheet — Defending the RAG Study Assistant

Use this to *own* the project in interviews. Don't memorize — understand. The interviewer is
testing whether you built it or copy-pasted it.

---

## 30-second pitch
> "I built a study assistant that answers questions from a user's own PDFs. It's a
> Retrieval-Augmented Generation pipeline: I extract and chunk the PDF text, embed each chunk
> into a vector, store them in a FAISS index, and at query time I retrieve the most relevant
> chunks and feed them to an LLM with a strict prompt to answer *only* from that context and
> cite the source page. Frontend's a streaming Next.js chat UI. I also wrote a small
> evaluation harness measuring Recall@k and MRR so I could verify retrieval quality."

---

## The questions they WILL ask

**Q: What is RAG and why not just use ChatGPT / fine-tuning?**
- RAG = retrieve relevant context first, then generate grounded on it.
- vs plain LLM: the model never saw the user's private PDFs; RAG injects that knowledge at
  query time without retraining.
- vs fine-tuning: fine-tuning teaches *style/behavior*, not new facts reliably, and is
  expensive to update. RAG is cheap to update (just add documents) and gives **citations**,
  which fine-tuning can't.

**Q: Why did you chunk? Why ~380 words with overlap?**
- Whole documents don't fit in the context window and dilute retrieval (a page about topic A
  shouldn't match a query about topic B). Chunks make retrieval *specific*.
- Too small → loses context; too big → less precise + more tokens. ~380 words (~500 tokens) is
  a balance. **Overlap (~60 words)** means a sentence sitting on a boundary still appears whole
  in a chunk, so we don't lose it. Trade-off: overlap = more vectors = more storage.

**Q: What's an embedding? Why does semantic search work?**
- A model maps text to a vector so that *similar meaning → nearby vectors*. "Powerhouse of the
  cell" and "produces ATP energy" land close even with zero shared keywords. We compare with
  **cosine similarity**.

**Q: Why FAISS and IndexFlatIP? Why normalize?**
- FAISS is a fast vector similarity library. `IndexFlatIP` = exact inner-product search.
- I L2-normalize vectors, so inner product == cosine similarity (scores in [-1, 1]).
- "Flat" = brute force = 100% recall, great for thousands of chunks. **At millions of vectors
  I'd switch to IVF or HNSW** — approximate indexes that trade a little recall for big speed.
  Knowing *when* to switch is the point.

**Q: How do you prevent hallucination?**
- System prompt forces "answer ONLY from the numbered context; if it's not there, say so."
- Low temperature (0.2) for faithful, non-creative output.
- **Citations** let the user verify every claim against the source page.

**Q: How do you handle an answer that spans multiple chunks?**
- I retrieve top-k (k=5), not just top-1, and pass all of them to the LLM, which synthesizes
  across them. Overlap also helps.

**Q: Query embedding vs passage embedding — why different?**
- bge is an *asymmetric* model: the query gets a special instruction prefix
  (`query_embed`) while passages are embedded plainly (`embed`). Using the right one
  measurably improves retrieval. Nice detail most people miss.

**Q: How did you measure that retrieval is any good?**
- `eval_retrieval.py`: a labelled set where each question has one correct passage. I compute
  **Recall@k** (is the right passage in the top-k?) and **MRR** (how high was it ranked?).
  Got Recall@3 = 1.0, MRR = 1.0 on my set.

**Q: How would you improve it? (shows depth)**
- **Reranking:** add a cross-encoder to re-order the top-k (helps when scores are close).
- **Hybrid search:** combine semantic + keyword (BM25) for names/acronyms/numbers.
- **Better chunking:** semantic/recursive splitting on headings instead of fixed windows.
- **Caching + streaming** (streaming already done).
- **Evaluation at scale:** RAGAS-style faithfulness/answer-relevance metrics.

**Q: How does it scale to many users / big docs?**
- Move FAISS → a managed vector DB (Pinecone/Qdrant/pgvector), add per-user namespaces,
  approximate indexing (HNSW), background ingestion queue, and an LLM rate-limit/retry layer.

**Q: Why streaming, and how does it work here?**
- Better UX (perceived latency). Backend yields NDJSON events (`sources`, then `token`s,
  then `done`) over a `StreamingResponse`; the frontend reads the `ReadableStream`, splits on
  newlines, and appends tokens to the message as they arrive.

**Q: How do you handle scanned PDFs or photos of book pages?**
- Those are image-only — no text layer — so plain extraction returns nothing. I use a **hybrid
  strategy**: read the embedded text layer first (fast), and only if a page is basically empty
  do I **render it to an image (PyMuPDF) and OCR it (RapidOCR, ONNX)**. Cheap-first, OCR-only-
  when-needed keeps native PDFs fast while still supporting scans. Bundled ONNX models mean no
  Tesseract install and it works offline.

---

## Weaknesses to admit honestly (interviewers respect this)
- Fixed-size chunking is naive — semantic chunking would be better.
- No reranker yet — top results can be close in score.
- OCR handles scanned/photo PDFs, but messy phone photos (skew, glare) can still hurt accuracy.
- Single-node FAISS in memory — not multi-user production-ready yet.

## Words that signal you know your stuff
embeddings · cosine similarity · vector index · top-k retrieval · chunking + overlap ·
grounding · hallucination · reranking · hybrid search · Recall@k · MRR · context window
