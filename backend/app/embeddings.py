"""Turns text into vectors using fastembed (ONNX, no PyTorch needed)."""
from functools import lru_cache
from typing import List
import numpy as np
from fastembed import TextEmbedding

from . import config


@lru_cache(maxsize=1)
def _model() -> TextEmbedding:
    return TextEmbedding(model_name=config.EMBED_MODEL)


def _normalize(vecs: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms[norms == 0] = 1e-12
    return vecs / norms


def embed_passages(texts: List[str]) -> np.ndarray:
    vecs = np.array(list(_model().embed(texts)), dtype="float32")
    return _normalize(vecs)


def iter_embed_passages(texts: List[str]):
    """Yield one L2-normalized vector per text as it's produced (drives the upload progress bar)."""
    for v in _model().embed(texts):
        v = np.asarray(v, dtype="float32")
        norm = np.linalg.norm(v) or 1e-12
        yield v / norm


def embed_query(text: str) -> np.ndarray:
    vec = np.array(list(_model().query_embed([text])), dtype="float32")
    return _normalize(vec)
