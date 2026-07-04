"""Stage 3: embeddings. Turns text into vectors that capture *meaning*, so that
semantically similar text lands close together in vector space.

Design choices (interview notes):
- We use fastembed (ONNX runtime) instead of sentence-transformers/PyTorch: ~10x lighter,
  fast on CPU, no GPU needed. Good "efficiency" talking point.
- BAAI/bge-small-en-v1.5 is an *asymmetric* retrieval model: queries and passages are
  embedded slightly differently. fastembed's query_embed() adds the query instruction, while
  embed() encodes passages. Using the right one measurably improves retrieval quality.
- We L2-normalize every vector so that a FAISS inner-product search == cosine similarity.
"""
from functools import lru_cache
from typing import List
import numpy as np
from fastembed import TextEmbedding

from . import config


@lru_cache(maxsize=1)
def _model() -> TextEmbedding:
    # Loaded once (downloads the ONNX model on first run, then cached on disk).
    return TextEmbedding(model_name=config.EMBED_MODEL)


def _normalize(vecs: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms[norms == 0] = 1e-12
    return vecs / norms


def embed_passages(texts: List[str]) -> np.ndarray:
    vecs = np.array(list(_model().embed(texts)), dtype="float32")
    return _normalize(vecs)


def iter_embed_passages(texts: List[str]):
    """Yield one L2-normalized vector per text as it is produced.

    fastembed's embed() is a generator, so consuming it incrementally gives us *real*
    per-chunk embedding progress (used to drive the upload progress bar).
    """
    for v in _model().embed(texts):
        v = np.asarray(v, dtype="float32")
        norm = np.linalg.norm(v) or 1e-12
        yield v / norm


def embed_query(text: str) -> np.ndarray:
    vec = np.array(list(_model().query_embed([text])), dtype="float32")
    return _normalize(vec)
