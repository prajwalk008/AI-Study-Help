"""Checks for resumable, part-by-part PDF indexing."""
import asyncio
import io
import unittest
from unittest.mock import patch

import fitz
from fastapi import UploadFile

from app import durable_jobs, jobs, main
from app.ingest_worker import process_next_part


MANIFEST = {
    "doc_id": "a" * 32,
    "chat_id": "chat-1",
    "filename": "notes.pdf",
    "total_segments": 2,
    "total_pages": 2,
}


class FakeEngine:
    def __init__(self):
        self.calls = []

    def ingest_pdf_segment(self, chat_id, path, filename, doc_id, **options):
        self.calls.append(options["segment_index"])
        current = jobs.get_job(doc_id)
        count = current["total_chunks"] + 1
        jobs.update_job(doc_id, page_tail=["last"], chunk_counter=count, total_chunks=count)
        yield {"type": "progress", "stage": "Embedding", "pct": 0.5}
        yield {"type": "segment_done"}


class DurableIngestionTests(unittest.TestCase):
    def test_one_part_is_processed_then_checkpointed(self):
        engine = FakeEngine()
        state = durable_jobs.initial_state(MANIFEST)
        updates = []

        def update(**fields):
            state.update(fields)
            updates.append(fields)

        with patch.object(durable_jobs, "load_manifest", return_value=MANIFEST), \
             patch.object(durable_jobs, "ready", return_value=True), \
             patch.object(durable_jobs, "part_info", return_value={"page_offset": 0}), \
             patch.object(durable_jobs, "download_part", return_value=b"part data"):
            more = process_next_part(MANIFEST["doc_id"], state, update, engine=engine)

        self.assertTrue(more)
        self.assertEqual(engine.calls, [0])
        self.assertEqual(state["completed_segments"], 1)
        self.assertEqual(state["total_chunks"], 1)
        self.assertEqual(state["status"], "queued")
        self.assertTrue(updates)

    def test_retry_resumes_at_saved_part(self):
        engine = FakeEngine()
        state = {**durable_jobs.initial_state(MANIFEST),
                 "completed_segments": 1, "page_tail": ["before"],
                 "chunk_counter": 2, "total_chunks": 2}

        def update(**fields):
            state.update(fields)

        with patch.object(durable_jobs, "load_manifest", return_value=MANIFEST), \
             patch.object(durable_jobs, "ready", return_value=True), \
             patch.object(durable_jobs, "part_info", return_value={"page_offset": 1}), \
             patch.object(durable_jobs, "download_part", return_value=b"part data"):
            more = process_next_part(MANIFEST["doc_id"], state, update, engine=engine)

        self.assertFalse(more)
        self.assertEqual(engine.calls, [1])
        self.assertEqual(state["status"], "done")
        self.assertEqual(state["stats"]["chunks"], 3)

    def test_final_upload_enqueues_one_document(self):
        pdf = fitz.open()
        pdf.new_page()
        data = pdf.tobytes()
        pdf.close()
        one_part = {**MANIFEST, "total_segments": 1, "total_pages": 1}
        upload = UploadFile(file=io.BytesIO(data), filename="notes.pdf")
        with patch("app.main.uuid.uuid4") as new_id, \
             patch.object(durable_jobs, "load_manifest", return_value=None), \
             patch.object(durable_jobs, "load_state", return_value=None), \
             patch.object(durable_jobs, "create_manifest", return_value=one_part), \
             patch.object(durable_jobs, "put_part"), \
             patch.object(durable_jobs, "ready", return_value=True), \
             patch.object(durable_jobs, "enqueue_document") as enqueue:
            new_id.return_value.hex = one_part["doc_id"]
            response = asyncio.run(main.upload_segment(
                chat_id="chat-1", filename="notes.pdf", segment_index=0,
                total_segments=1, page_offset=0, total_pages=1,
                doc_id="", file=upload,
            ))
        self.assertEqual(response, {"doc_id": one_part["doc_id"]})
        enqueue.assert_called_once_with(one_part)

    def test_first_part_retry_reuses_document_id(self):
        pdf = fitz.open()
        pdf.new_page()
        data = pdf.tobytes()
        pdf.close()
        with patch.object(durable_jobs, "load_manifest", side_effect=[None, MANIFEST]), \
             patch.object(durable_jobs, "load_state", return_value=None), \
             patch.object(durable_jobs, "create_manifest", return_value=MANIFEST) as create, \
             patch.object(durable_jobs, "put_part") as put:
            for _ in range(2):
                response = asyncio.run(main.upload_segment(
                    chat_id="chat-1", filename="notes.pdf", segment_index=0,
                    total_segments=2, page_offset=0, total_pages=2,
                    doc_id=MANIFEST["doc_id"],
                    file=UploadFile(file=io.BytesIO(data), filename="notes.pdf"),
                ))
                self.assertEqual(response, {"doc_id": MANIFEST["doc_id"]})
        create.assert_called_once()
        self.assertEqual(put.call_count, 2)


if __name__ == "__main__":
    unittest.main()
