"""The RAG engine: ties the pipeline together (retrieve -> assemble grounded prompt ->
generate). This is the file to walk an interviewer through.

Why RAG instead of just asking the LLM?
- The model never saw the user's private study PDFs during training.
- Instead of stuffing whole documents into the prompt (expensive, hits context limits), we
  retrieve only the few most relevant chunks and ground the answer on them.
- We instruct the model to answer ONLY from the retrieved context and to cite sources,
  which sharply reduces hallucination and makes every answer verifiable.
"""
import uuid
from typing import Iterator, List, Dict, Tuple

import numpy as np

from . import config, embeddings, store_manager
from .ingest import chunk_document, stream_pages, chunks_from_pages

# Phase weights for the upload progress bar. Extraction/OCR and embedding are the two costly
# phases; indexing + save is near-instant. These sum to <1.0; the remainder is the final snap
# to 100% once the vectors are persisted.
EXTRACT_WEIGHT = 0.40
EMBED_WEIGHT = 0.55
PROGRESS_STEP = 0.005  # only emit an event when progress advances by >=0.5% (avoids spam)

SYSTEM_PROMPT = (
    "You are a precise study assistant. Answer the student's question using ONLY the numbered "
    "context passages provided. Cite the passages you use with bracketed numbers like [1], [2]. "
    "If the answer is not contained in the context, say you could not find it in the provided "
    "documents rather than guessing. Be clear and concise, and explain concepts simply."
)


class RAGEngine:
    """Stateless orchestrator; the per-chat vector store is resolved via store_manager."""

    def ingest_pdf_stream(self, chat_id: str, pdf_path: str, doc_name: str) -> Iterator[dict]:
        """Ingest a PDF into the given chat's index, yielding progress events.

        Emits: {"type":"progress","stage":str,"pct":float 0..1}, then either
        {"type":"empty"} (no extractable text) or {"type":"done","stats":{...}}.
        """
        doc_id = uuid.uuid4().hex[:8]

        # Phase 1: extract text / OCR, page by page.
        pages: List[str] = []
        last_pct = 0.0
        for idx, total, text in stream_pages(pdf_path):
            pages.append(text)
            pct = EXTRACT_WEIGHT * (idx + 1) / max(total, 1)
            if pct - last_pct >= PROGRESS_STEP or idx + 1 == total:
                last_pct = pct
                yield {"type": "progress", "stage": f"Reading pages ({idx + 1}/{total})", "pct": round(pct, 4)}

        chunks = chunks_from_pages(pages, doc_id, doc_name)
        if not chunks:
            yield {"type": "empty"}
            return

        # Phase 2: embed chunks, reporting progress as each vector is produced.
        texts = [c.text for c in chunks]
        n = len(texts)
        vecs: List[np.ndarray] = []
        last_pct = EXTRACT_WEIGHT
        for j, vec in enumerate(embeddings.iter_embed_passages(texts)):
            vecs.append(vec)
            pct = EXTRACT_WEIGHT + EMBED_WEIGHT * (j + 1) / n
            if pct - last_pct >= PROGRESS_STEP or j + 1 == n:
                last_pct = pct
                yield {"type": "progress", "stage": f"Embedding chunks ({j + 1}/{n})", "pct": round(pct, 4)}

        # Phase 3: index + persist (guarded by the chat's lock).
        yield {"type": "progress", "stage": "Indexing", "pct": 0.97}
        with store_manager.get_lock(chat_id):
            store_manager.get_store(chat_id).add(chunks, np.array(vecs, dtype="float32"))
        pages_count = max(c.page for c in chunks)
        yield {
            "type": "done",
            "pct": 1.0,
            "stats": {"doc_id": doc_id, "doc_name": doc_name, "chunks": n, "pages": pages_count},
        }

    def retrieve(self, chat_id: str, question: str, k: int = config.TOP_K) -> List[Tuple[dict, float]]:
        qvec = embeddings.embed_query(question)
        with store_manager.get_lock(chat_id):
            return store_manager.get_store(chat_id).search(qvec, k)

    def documents(self, chat_id: str) -> List[dict]:
        with store_manager.get_lock(chat_id):
            return store_manager.get_store(chat_id).documents()

    def _build_messages(self, question: str, hits: List[Tuple[dict, float]]) -> List[Dict[str, str]]:
        context_blocks = []
        for i, (meta, _score) in enumerate(hits, start=1):
            context_blocks.append(
                f"[{i}] (source: {meta['doc_name']}, p.{meta['page']})\n{meta['text']}"
            )
        context = "\n\n".join(context_blocks) if context_blocks else "(no relevant passages found)"
        user = f"Context passages:\n{context}\n\nQuestion: {question}"
        return [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ]

    def build_prompt(self, question: str, hits: List[Tuple[dict, float]]) -> List[Dict[str, str]]:
        return self._build_messages(question, hits)
