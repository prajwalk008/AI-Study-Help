"""Per-chat access to the shared Qdrant collection (see vectorstore.py)."""
import re
import threading
from typing import Dict

from .vectorstore import VectorStore

CHAT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
UPLOAD_ID_RE = re.compile(r"^[0-9a-fA-F-]{16,64}$")

_stores: Dict[str, VectorStore] = {}
_locks: Dict[str, threading.Lock] = {}
_global_lock = threading.Lock()


def valid_chat_id(chat_id: str) -> bool:
    return bool(chat_id) and bool(CHAT_ID_RE.match(chat_id))


def valid_upload_id(upload_id: str) -> bool:
    return bool(upload_id) and bool(UPLOAD_ID_RE.match(upload_id))


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
            store = VectorStore(chat_id)
            _stores[chat_id] = store
        return store


def drop_store(chat_id: str) -> None:
    with _global_lock:
        store = _stores.pop(chat_id, None)
        _locks.pop(chat_id, None)
    (store or VectorStore(chat_id)).delete()
