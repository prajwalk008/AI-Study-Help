"""Start FastAPI with a small deterministic PDF processor for local tests."""
import os
import sys
import threading
import time

sys.path.insert(0, "/app")

import uvicorn

from azure.core.exceptions import ResourceExistsError

from app import durable_jobs, ingest_worker, jobs, queue_worker

_failed_once = set()


class FakeEngine:
    def ingest_pdf_segment(self, chat_id, path, filename, doc_id, **options):
        if filename == "retry.pdf" and doc_id not in _failed_once:
            _failed_once.add(doc_id)
            raise RuntimeError("Temporary indexing failure")
        if filename == "heartbeat.pdf":
            time.sleep(25)
        state = jobs.get_job(doc_id)
        count = state["total_chunks"] + 1
        jobs.update_job(
            doc_id,
            page_tail=[f"part-{options['segment_index']}"],
            chunk_counter=count,
            total_chunks=count,
        )
        yield {"type": "progress", "stage": "Reading PDF", "pct": count / 3}
        yield {"type": "segment_done"}


ingest_worker.RAGEngine = FakeEngine

try:
    durable_jobs.container().create_container()
except ResourceExistsError:
    pass


def run_test_worker():
    while True:
        try:
            if not queue_worker.run_once():
                time.sleep(0.5)
        except Exception:
            time.sleep(0.5)


threading.Thread(target=run_test_worker, daemon=True).start()

from app.main import app

uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("RECALL_TEST_PORT", "8000")))
