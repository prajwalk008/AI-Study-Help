"""Ties the pipeline together: retrieve chunks, build a grounded prompt, generate an answer."""
from typing import Iterator, List, Dict, Tuple

import numpy as np

from . import config, embeddings, store_manager
from .ingest import chunk_page, stream_pages

PROCESS_WEIGHT = 0.95  # rest of the bar is the final indexing step
PROGRESS_STEP = 0.005
INGEST_BATCH_SIZE = 100  # flush to qdrant every N chunks instead of holding the whole doc in memory

SYSTEM_PROMPT = (
    "You are a precise study assistant. Answer the student's question using ONLY the numbered "
    "context passages provided. Cite the passages you use with bracketed numbers like [1], [2]. "
    "If the answer is not contained in the context, say you could not find it in the provided "
    "documents rather than guessing. Be clear and concise, and explain concepts simply."
)


class RAGEngine:
    def ingest_pdf_stream(self, chat_id: str, pdf_path: str, doc_name: str, doc_id: str) -> Iterator[dict]:
        total_chunks = 0
        pages_count = 0
        batch_chunks: List = []
        batch_vecs: List[np.ndarray] = []
        last_pct = 0.0

        def flush_batch():
            nonlocal batch_chunks, batch_vecs
            if not batch_chunks:
                return
            with store_manager.get_lock(chat_id):
                store_manager.get_store(chat_id).add(batch_chunks, np.array(batch_vecs, dtype="float32"))
            batch_chunks = []
            batch_vecs = []

        # process one page at a time (extract -> chunk -> embed -> flush) so memory
        # usage stays flat instead of growing with document size
        for idx, total, text in stream_pages(pdf_path):
            pages_count = idx + 1
            page_chunks = chunk_page(text, pages_count, doc_id, doc_name)
            if page_chunks:
                page_vecs = list(embeddings.iter_embed_passages([c.text for c in page_chunks]))
                batch_chunks.extend(page_chunks)
                batch_vecs.extend(page_vecs)
                total_chunks += len(page_chunks)
                if len(batch_chunks) >= INGEST_BATCH_SIZE:
                    flush_batch()

            pct = PROCESS_WEIGHT * (idx + 1) / max(total, 1)
            if pct - last_pct >= PROGRESS_STEP or idx + 1 == total:
                last_pct = pct
                yield {"type": "progress", "stage": f"Processing pages ({idx + 1}/{total})", "pct": round(pct, 4)}

        flush_batch()

        if total_chunks == 0:
            yield {"type": "empty"}
            return

        yield {"type": "progress", "stage": "Indexing", "pct": 0.97}
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
