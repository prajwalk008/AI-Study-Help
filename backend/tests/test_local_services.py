"""Upload two PDF parts through FastAPI with local Blob and Queue services."""
import io
import os
import time
import unittest
import uuid

import fitz
import requests


@unittest.skipUnless(os.getenv("RECALL_TEST_LOCAL_SERVICES"), "Local services are not configured")
class LocalServicesTests(unittest.TestCase):
    def test_slow_part_keeps_its_lease(self):
        pdf = fitz.open()
        pdf.new_page()
        part = pdf.tobytes()
        pdf.close()
        base = "http://127.0.0.1:18000"
        headers = {"x-internal-secret": "recall-local-test-secret"}
        response = requests.post(
            base + "/api/upload/segment",
            params={
                "chat_id": "test-chat-" + uuid.uuid4().hex[:8],
                "filename": "heartbeat.pdf", "segment_index": 0, "total_segments": 1,
                "page_offset": 0, "total_pages": 1,
            },
            files={"file": ("heartbeat.pdf", io.BytesIO(part), "application/pdf")},
            headers=headers, timeout=20,
        )
        self.assertEqual(response.status_code, 200, response.text)
        doc_id = response.json()["doc_id"]
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            status = requests.get(
                base + "/api/upload/status", params={"doc_id": doc_id},
                headers=headers, timeout=10,
            ).json()
            if status["status"] == "done":
                self.assertEqual(status["completed_segments"], 1)
                return
            if status["status"] == "error":
                self.fail(str(status))
            time.sleep(0.5)
        self.fail("Timed out waiting for the slow part")

    def test_failed_part_is_retried(self):
        pdf = fitz.open()
        pdf.new_page()
        part = pdf.tobytes()
        pdf.close()
        base = "http://127.0.0.1:18000"
        headers = {"x-internal-secret": "recall-local-test-secret"}
        response = requests.post(
            base + "/api/upload/segment",
            params={
                "chat_id": "test-chat-" + uuid.uuid4().hex[:8],
                "filename": "retry.pdf", "segment_index": 0, "total_segments": 1,
                "page_offset": 0, "total_pages": 1,
            },
            files={"file": ("retry.pdf", io.BytesIO(part), "application/pdf")},
            headers=headers, timeout=20,
        )
        self.assertEqual(response.status_code, 200, response.text)
        doc_id = response.json()["doc_id"]
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            status = requests.get(
                base + "/api/upload/status", params={"doc_id": doc_id},
                headers=headers, timeout=10,
            ).json()
            if status["status"] == "done":
                self.assertEqual(status["completed_segments"], 1)
                self.assertEqual(status["stats"]["chunks"], 1)
                return
            if status["status"] == "error":
                self.fail(str(status))
            time.sleep(0.5)
        self.fail("Timed out waiting for the retry")

    def test_two_part_upload_reaches_the_worker(self):
        base = "http://127.0.0.1:18000"
        headers = {"x-internal-secret": "recall-local-test-secret"}
        chat_id = "test-chat-" + uuid.uuid4().hex[:8]
        doc_id = uuid.uuid4().hex
        pdf_parts = []
        for _ in range(2):
            pdf = fitz.open()
            pdf.new_page()
            pdf_parts.append(pdf.tobytes())
            pdf.close()

        for index, part in enumerate(pdf_parts):
            params = {
                "chat_id": chat_id,
                "filename": "notes.pdf",
                "segment_index": index,
                "total_segments": 2,
                "page_offset": index,
                "total_pages": 2,
                "doc_id": doc_id,
            }
            response = requests.post(
                base + "/api/upload/segment", params=params,
                files={"file": (f"part-{index}.pdf", io.BytesIO(part), "application/pdf")},
                headers=headers, timeout=20,
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["doc_id"], doc_id)
            if index == 0:
                repeat_first = requests.post(
                    base + "/api/upload/segment", params=params,
                    files={"file": ("part-0.pdf", io.BytesIO(part), "application/pdf")},
                    headers=headers, timeout=20,
                )
                self.assertEqual(repeat_first.status_code, 200, repeat_first.text)
                self.assertEqual(repeat_first.json()["doc_id"], doc_id)

        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            response = requests.get(
                base + "/api/upload/status", params={"doc_id": doc_id},
                headers=headers, timeout=10,
            )
            self.assertEqual(response.status_code, 200, response.text)
            job = response.json()
            if job["status"] == "done":
                self.assertEqual(job["completed_segments"], 2)
                self.assertEqual(job["stats"]["chunks"], 2)
                repeat = requests.post(
                    base + "/api/upload/segment", params=params,
                    files={"file": ("part-1.pdf", io.BytesIO(pdf_parts[-1]), "application/pdf")},
                    headers=headers, timeout=20,
                )
                self.assertEqual(repeat.status_code, 200, repeat.text)
                self.assertEqual(repeat.json()["doc_id"], doc_id)
                return
            if job["status"] == "error":
                self.fail(str(job))
            time.sleep(0.5)
        self.fail("Timed out waiting for the PDF job")


if __name__ == "__main__":
    unittest.main()
