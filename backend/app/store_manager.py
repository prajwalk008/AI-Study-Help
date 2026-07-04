"""Multi-tenant vector store manager: one FAISS index per chat, isolated on disk.

Isolation makes deletion trivial (drop the directory) and prevents one chat's book from ever
leaking into another chat's retrieval. A per-chat lock guards concurrent add/search/delete,
since a single uvicorn worker may run several requests in its thread pool.
"""
import os
import re
import shutil
import threading
from typing import Dict

from . import config
from .vectorstore import VectorStore

# chat_id must be a simple token (Mongo ObjectId hex / UUID-ish). This, plus the path-containment
# check below, blocks path-traversal via a malicious chat_id.
CHAT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

_stores: Dict[str, VectorStore] = {}
_locks: Dict[str, threading.Lock] = {}
_global_lock = threading.Lock()


def valid_chat_id(chat_id: str) -> bool:
    return bool(chat_id) and bool(CHAT_ID_RE.match(chat_id))


def _chat_dir(chat_id: str) -> str:
    base = os.path.abspath(config.INDEX_DIR)
    path = os.path.abspath(os.path.join(base, chat_id))
    if os.path.commonpath([base, path]) != base:
        raise ValueError("invalid chat_id path")
    return path


def get_lock(chat_id: str) -> threading.Lock:
    with _global_lock:
        lock = _locks.get(chat_id)
        if lock is None:
            lock = threading.Lock()
            _locks[chat_id] = lock
        return lock


def get_store(chat_id: str) -> VectorStore:
    with _global_lock:
        store = _stores.get(chat_id)
        if store is None:
            store = VectorStore(_chat_dir(chat_id))
            _stores[chat_id] = store
        return store


def drop_store(chat_id: str) -> None:
    with _global_lock:
        _stores.pop(chat_id, None)
        _locks.pop(chat_id, None)
    directory = _chat_dir(chat_id)
    if os.path.isdir(directory):
        shutil.rmtree(directory, ignore_errors=True)
