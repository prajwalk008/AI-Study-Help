"""Stage 4: the vector store. A FAISS index holds every chunk's embedding and lets us
find the nearest ones to a query in milliseconds.

Design choices (interview notes):
- FAISS IndexFlatIP does exact inner-product search. Because vectors are L2-normalized,
  inner product == cosine similarity, giving scores in a clean [-1, 1] range.
- "Flat" = brute force = exact results. Perfect for a study app (thousands of chunks). At
  millions of vectors you'd switch to an approximate index (IVF/HNSW) to trade a little
  recall for a lot of speed. Knowing *when* to switch is the real interview signal.
- We persist the index + a parallel metadata list so chunks survive restarts.
"""
import json
import os
from typing import List, Tuple
import faiss
import numpy as np

from . import config
from .ingest import Chunk


class VectorStore:
    def __init__(self, index_dir: str):
        self.index_dir = index_dir
        self.index_path = os.path.join(index_dir, "faiss.index")
        self.meta_path = os.path.join(index_dir, "meta.json")
        self.index = faiss.IndexFlatIP(config.EMBED_DIM)
        self.metas: List[dict] = []  # parallel to index vectors: metas[i] describes vector i
        self._load()

    def _load(self):
        if os.path.exists(self.index_path) and os.path.exists(self.meta_path):
            self.index = faiss.read_index(self.index_path)
            with open(self.meta_path, "r", encoding="utf-8") as f:
                self.metas = json.load(f)

    def _save(self):
        os.makedirs(self.index_dir, exist_ok=True)
        faiss.write_index(self.index, self.index_path)
        with open(self.meta_path, "w", encoding="utf-8") as f:
            json.dump(self.metas, f, ensure_ascii=False)

    def add(self, chunks: List[Chunk], embeddings: np.ndarray):
        self.index.add(embeddings)
        self.metas.extend(c.to_dict() for c in chunks)
        self._save()

    def search(self, query_vec: np.ndarray, k: int) -> List[Tuple[dict, float]]:
        if self.index.ntotal == 0:
            return []
        k = min(k, self.index.ntotal)
        scores, idxs = self.index.search(query_vec, k)
        results = []
        for score, idx in zip(scores[0], idxs[0]):
            if idx == -1:
                continue
            results.append((self.metas[idx], float(score)))
        return results

    def documents(self) -> List[dict]:
        docs = {}
        for m in self.metas:
            d = docs.setdefault(m["doc_id"], {"doc_id": m["doc_id"], "doc_name": m["doc_name"], "chunks": 0})
            d["chunks"] += 1
        return list(docs.values())

    @property
    def total_chunks(self) -> int:
        return self.index.ntotal
