"""Ties the pipeline together: retrieve chunks, build a grounded prompt, generate an answer."""
import uuid
from typing import Iterator, List, Dict, Tuple

import numpy as np

from . import config, embeddings, store_manager
from .ingest import chunk_document, stream_pages, chunks_from_pages

# progress bar weights for the upload stream; extraction/embedding are the slow parts
EXTRACT_WEIGHT = 0.40
EMBED_WEIGHT = 0.55
PROGRESS_STEP = 0.005

SYSTEM_PROMPT = (
    "You are a precise study assistant. Answer the student's question using ONLY the numbered "
    "context passages provided. Cite the passages you use with bracketed numbers like [1], [2]. "
    "If the answer is not contained in the context, say you could not find it in the provided "
    "documents rather than guessing. Be clear and concise, and explain concepts simply."
)


class RAGEngine:
    def ingest_pdf_stream(self, chat_id: str, pdf_path: str, doc_name: str) -> Iterator[dict]:
        doc_id = uuid.uuid4().hex[:8]

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

        texts = [c.text for c in chunks]
        total_chunks = len(texts)
        vecs: List[np.ndarray] = []
        last_pct = EXTRACT_WEIGHT
        for i, vec in enumerate(embeddings.iter_embed_passages(texts)):
            vecs.append(vec)
            pct = EXTRACT_WEIGHT + EMBED_WEIGHT * (i + 1) / total_chunks
            if pct - last_pct >= PROGRESS_STEP or i + 1 == total_chunks:
                last_pct = pct
                yield {"type": "progress", "stage": f"Embedding chunks ({i + 1}/{total_chunks})", "pct": round(pct, 4)}

        yield {"type": "progress", "stage": "Indexing", "pct": 0.97}
        with store_manager.get_lock(chat_id):
            store_manager.get_store(chat_id).add(chunks, np.array(vecs, dtype="float32"))
        pages_count = max(c.page for c in chunks)
        yield {
            "type": "done",
            "pct": 1.0,
            "stats": {"doc_id": doc_id, "doc_name": doc_name, "chunks": total_chunks, "pages": pages_count},
        }

    def retrieve(self, chat_id: str, question: str, k: int = config.TOP_K) -> List[Tuple[dict, float]]:
        qvec = embeddings.embed_query(question)
        with store_manager.get_lock(chat_id):
            return store_manager.get_store(chat_id).search(qvec, k)

    def documents(self, chat_id: str) -> List[dict]:
        with store_manager.get_lock(chat_id):
            return store_manager.get_store(chat_id).documents()

    def _build_messages(self, question: str, hits: List[Tuple[dict, float]]) -> List[Dict[str, str]]:
        blocks = []
        for i, (meta, _score) in enumerate(hits, start=1):
            blocks.append(f"[{i}] (source: {meta['doc_name']}, p.{meta['page']})\n{meta['text']}")
        context = "\n\n".join(blocks) if blocks else "(no relevant passages found)"
        prompt = f"Context passages:\n{context}\n\nQuestion: {question}"
        return [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]

    def build_prompt(self, question: str, hits: List[Tuple[dict, float]]) -> List[Dict[str, str]]:
        return self._build_messages(question, hits)
