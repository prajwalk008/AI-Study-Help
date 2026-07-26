"""In-memory registry for background ingestion jobs (single Render instance, no queue needed)."""
import threading
from typing import Dict, Optional

_jobs: Dict[str, dict] = {}
_lock = threading.Lock()


def create_job(doc_id: str) -> None:
    with _lock:
        _jobs[doc_id] = {"status": "queued", "stage": "Queued", "pct": 0.0, "stats": None, "error": None}


def update_job(doc_id: str, **fields) -> None:
    with _lock:
        job = _jobs.get(doc_id)
        if job is not None:
            job.update(fields)


def get_job(doc_id: str) -> Optional[dict]:
    with _lock:
        job = _jobs.get(doc_id)
        return dict(job) if job is not None else None
