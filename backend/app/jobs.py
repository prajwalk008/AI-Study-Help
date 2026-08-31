"""In-memory registry for background ingestion jobs (single Render instance, no queue needed)."""
import threading
from typing import Dict, List, Optional

_jobs: Dict[str, dict] = {}
_lock = threading.Lock()


def create_job(
    doc_id: str,
    *,
    total_segments: int = 1,
    total_pages: int = 0,
    doc_name: str = "",
) -> None:
    with _lock:
        _jobs[doc_id] = {
            "status": "queued",
            "stage": "Queued",
            "pct": 0.0,
            "stats": None,
            "error": None,
            "total_segments": total_segments,
            "total_pages": total_pages,
            "completed_segments": 0,
            "total_chunks": 0,
            "chunk_counter": 0,
            "doc_name": doc_name,
            "page_tail": [],
        }


def update_job(doc_id: str, **fields) -> None:
    with _lock:
        job = _jobs.get(doc_id)
        if job is not None:
            job.update(fields)


def get_job(doc_id: str) -> Optional[dict]:
    with _lock:
        job = _jobs.get(doc_id)
        return dict(job) if job is not None else None


def get_page_tail(doc_id: str) -> List[str]:
    with _lock:
        job = _jobs.get(doc_id)
        return list(job["page_tail"]) if job else []


def set_page_tail(doc_id: str, tail: List[str]) -> None:
    with _lock:
        job = _jobs.get(doc_id)
        if job is not None:
            job["page_tail"] = tail
