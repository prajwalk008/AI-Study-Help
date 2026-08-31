"""Ties the pipeline together: retrieve chunks, build a grounded prompt, generate an answer."""
import os
from typing import Iterator, List, Dict, Tuple

import numpy as np

from . import config, embeddings, jobs, store_manager
from .ingest import PageTailChunker, stream_pages

PROCESS_WEIGHT = 0.95
PROGRESS_STEP = 0.005

SYSTEM_PROMPT = (
    "You are a precise study assistant. Answer the student's question using ONLY the numbered "
    "context passages provided. Cite the passages you use with bracketed numbers like [1], [2]. "
    "If the answer is not contained in the context, say you could not find it in the provided "
    "documents rather than guessing. Be clear and concise, and explain concepts simply."
)


class RAGEngine:
    def ingest_pdf_segment(
        self,
        chat_id: str,
        pdf_path: str,
        doc_name: str,
        doc_id: str,
        *,
        page_offset: int,
        total_pages: int,
        segment_index: int,
        total_segments: int,
    ) -> Iterator[dict]:
        job = jobs.get_job(doc_id) or {}
        chunker = PageTailChunker(
            doc_id,
            doc_name,
            initial_tail=job.get("page_tail") or [],
            chunk_counter=job.get("chunk_counter", 0),
        )
        segment_chunks = 0
        batch_chunks: List = []
        batch_vecs: List[np.ndarray] = []
        last_pct = job.get("pct", 0.0)

        def flush_batch():
            nonlocal batch_chunks, batch_vecs
            if not batch_chunks:
                return
            with store_manager.get_lock(chat_id):
                store_manager.get_store(chat_id).add(batch_chunks, np.array(batch_vecs, dtype="float32"))
            batch_chunks = []
            batch_vecs = []

        for page_idx, _total, text in stream_pages(
            pdf_path, page_offset=page_offset, total_pages=total_pages
        ):
            page_no = page_idx + 1
            page_chunks = chunker.process_page(page_no, text)
            if page_chunks:
                page_vecs = list(embeddings.iter_embed_passages([c.text for c in page_chunks]))
                batch_chunks.extend(page_chunks)
                batch_vecs.extend(page_vecs)
                segment_chunks += len(page_chunks)
                if len(batch_chunks) >= config.INGEST_BATCH_SIZE:
                    flush_batch()

            seg_base = segment_index / max(total_segments, 1)
            seg_span = 1 / max(total_segments, 1)
            page_frac = page_no / max(total_pages, 1)
            pct = PROCESS_WEIGHT * (seg_base + seg_span * page_frac)
            if pct - last_pct >= PROGRESS_STEP or page_no == total_pages:
                last_pct = pct
                yield {
                    "type": "progress",
                    "stage": f"Part {segment_index + 1}/{total_segments} — pages ({page_no}/{total_pages})",
                    "pct": round(pct, 4),
                }

        flush_batch()
        jobs.update_job(
            doc_id,
            page_tail=chunker.tail_words(),
            chunk_counter=chunker.chunk_counter,
            total_chunks=job.get("total_chunks", 0) + segment_chunks,
        )

        if segment_chunks == 0 and segment_index == 0 and total_segments == 1:
            yield {"type": "empty"}
            return

        yield {
            "type": "segment_done",
            "segment_chunks": segment_chunks,
            "chunk_counter": chunker.chunk_counter,
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
