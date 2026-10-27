"""Runs against the isolated Azurite test container."""
import os
import unittest
import uuid
from unittest.mock import patch

from azure.storage.blob import BlobServiceClient
from azure.storage.queue import QueueServiceClient

from app import config, durable_jobs, queue_worker


@unittest.skipUnless(os.getenv("RECALL_TEST_AZURITE"), "Azurite is not configured")
class BlobStorageTests(unittest.TestCase):
    def test_parts_are_saved_once_and_ready_in_order(self):
        service = BlobServiceClient.from_connection_string(config.AZURE_STORAGE_CONNECTION_STRING)
        name = "recall-test-" + uuid.uuid4().hex[:12]
        old_container = config.AZURE_BLOB_CONTAINER
        config.AZURE_BLOB_CONTAINER = name
        durable_jobs.container.cache_clear()
        service.create_container(name)
        try:
            doc_id = uuid.uuid4().hex
            manifest = durable_jobs.create_manifest(doc_id, "chat-1", "notes.pdf", 2, 2)
            self.assertFalse(durable_jobs.ready(manifest))
            durable_jobs.put_part(doc_id, 0, b"first part", 0, 1)
            durable_jobs.put_part(doc_id, 0, b"first part", 0, 1)
            durable_jobs.put_part(doc_id, 1, b"second part", 1, 1)
            self.assertTrue(durable_jobs.ready(manifest))
            self.assertEqual(durable_jobs.download_part(doc_id, 1), b"second part")
            self.assertEqual(durable_jobs.load_manifest(doc_id), manifest)
            with self.assertRaises(ValueError):
                durable_jobs.put_part(doc_id, 0, b"changed", 0, 1)
            durable_jobs.cleanup_parts(manifest)
            self.assertIsNone(durable_jobs.part_info(doc_id, 0))
            self.assertIsNone(durable_jobs.part_info(doc_id, 1))
        finally:
            service.delete_container(name)
            config.AZURE_BLOB_CONTAINER = old_container
            durable_jobs.container.cache_clear()

    def test_job_state_and_queue_survive_a_new_client(self):
        blob_service = BlobServiceClient.from_connection_string(config.AZURE_STORAGE_CONNECTION_STRING)
        queue_service = QueueServiceClient.from_connection_string(config.AZURE_STORAGE_CONNECTION_STRING)
        name = "recall-test-" + uuid.uuid4().hex[:12]
        old_container, old_queue = config.AZURE_BLOB_CONTAINER, config.AZURE_QUEUE_NAME
        config.AZURE_BLOB_CONTAINER = name
        config.AZURE_QUEUE_NAME = name
        durable_jobs.container.cache_clear()
        durable_jobs.queue.cache_clear()
        blob_service.create_container(name)
        try:
            manifest = durable_jobs.create_manifest(uuid.uuid4().hex, "chat-1", "notes.pdf", 1, 1)
            durable_jobs.enqueue_document(manifest)
            durable_jobs.check_storage()
            message = durable_jobs.queue().receive_message()
            self.assertEqual(message.content, manifest["doc_id"])

            lease = durable_jobs.state_blob(manifest["doc_id"]).acquire_lease(lease_duration=60)
            state = durable_jobs.load_state(manifest["doc_id"])
            state.update(status="running", stage="Processing")
            durable_jobs.save_state(manifest["doc_id"], state, lease)
            lease.release()
            durable_jobs.container.cache_clear()
            self.assertEqual(durable_jobs.load_state(manifest["doc_id"])["status"], "running")
            durable_jobs.queue().delete_message(message.id, message.pop_receipt)
            self.assertEqual(durable_jobs.recover_pending(), 1)
            recovered = durable_jobs.queue().receive_message()
            self.assertEqual(recovered.content, manifest["doc_id"])
            durable_jobs.queue().delete_message(recovered.id, recovered.pop_receipt)

            next_manifest = durable_jobs.create_manifest(
                uuid.uuid4().hex, "chat-1", "more.pdf", 2, 2
            )
            durable_jobs.put_part(next_manifest["doc_id"], 0, b"part one", 0, 1)
            durable_jobs.put_part(next_manifest["doc_id"], 1, b"part two", 1, 1)
            durable_jobs.enqueue_document(next_manifest)

            def finish_part(doc_id, state, update):
                finished = state["completed_segments"] + 1
                update(
                    status="done" if finished == 2 else "queued",
                    completed_segments=finished, attempts=0,
                    stats={"chunks": 2} if finished == 2 else None,
                )
                return finished < 2

            with patch.object(queue_worker.ingest_worker, "process_next_part", side_effect=finish_part) as process:
                self.assertTrue(queue_worker.run_once())
            self.assertEqual(process.call_count, 2)
            self.assertEqual(durable_jobs.load_state(next_manifest["doc_id"])["status"], "done")
            self.assertIsNone(durable_jobs.part_info(next_manifest["doc_id"], 0))
            self.assertIsNone(durable_jobs.queue().receive_message())
        finally:
            queue_service.delete_queue(name)
            blob_service.delete_container(name)
            config.AZURE_BLOB_CONTAINER, config.AZURE_QUEUE_NAME = old_container, old_queue
            durable_jobs.container.cache_clear()
            durable_jobs.queue.cache_clear()
