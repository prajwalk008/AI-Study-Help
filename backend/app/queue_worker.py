"""Process one queued PDF in an on-demand worker execution."""
import logging
import re
import threading

from azure.core.exceptions import HttpResponseError

from . import durable_jobs, ingest_worker

log = logging.getLogger(__name__)
VISIBILITY_SECONDS = 120
LEASE_SECONDS = 60
HEARTBEAT_SECONDS = 20
MAX_ATTEMPTS = 3


class Heartbeat:
    def __init__(self, lease, client, message, worker_lease=None):
        self.lease = lease
        self.worker_lease = worker_lease
        self.client = client
        self.message = message
        self.receipt = message.pop_receipt
        self.error = None
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self):
        while not self.stop.wait(HEARTBEAT_SECONDS):
            try:
                self.lease.renew()
                if self.worker_lease is not None:
                    self.worker_lease.renew()
                updated = self.client.update_message(
                    self.message.id, self.receipt,
                    visibility_timeout=VISIBILITY_SECONDS,
                )
                self.receipt = updated.pop_receipt
            except Exception as error:
                self.error = error
                return

    def check(self):
        if self.error is not None:
            raise RuntimeError("Lost the PDF job lease") from self.error

    def close(self):
        self.stop.set()
        self.thread.join()
        self.check()


def process_message(client, message, worker_lease=None):
    doc_id = message.content
    if not re.fullmatch(r"[0-9a-f]{32}", doc_id):
        client.delete_message(message.id, message.pop_receipt)
        return

    manifest = durable_jobs.load_manifest(doc_id)
    if manifest is None:
        log.error("PDF job %s has no manifest", doc_id)
        client.delete_message(message.id, message.pop_receipt)
        return
    durable_jobs.ensure_state(manifest)
    try:
        lease = durable_jobs.state_blob(doc_id).acquire_lease(lease_duration=LEASE_SECONDS)
    except HttpResponseError as error:
        if error.status_code == 409:
            return  # Another replica owns this job; the message will reappear.
        raise

    heartbeat = None
    try:
        state = durable_jobs.load_state(doc_id)
        heartbeat = Heartbeat(lease, client, message, worker_lease)
        if state["status"] in ("done", "error"):
            heartbeat.close()
            client.delete_message(message.id, heartbeat.receipt)
            return

        def update(**fields):
            heartbeat.check()
            state.update(fields)
            durable_jobs.save_state(doc_id, state, lease)

        while True:
            attempt = state["attempts"] + 1
            update(status="running", stage="Processing PDF", attempts=attempt, error=None)
            try:
                more = ingest_worker.process_next_part(doc_id, state, update)
            except Exception as error:
                heartbeat.close()
                if attempt >= MAX_ATTEMPTS:
                    update(status="error", stage="Indexing failed", error=str(error))
                    client.delete_message(message.id, heartbeat.receipt)
                else:
                    update(status="queued", stage="Retrying PDF part", error=str(error))
                    client.update_message(
                        message.id, heartbeat.receipt,
                        visibility_timeout=5 * (2 ** (attempt - 1)),
                    )
                log.exception("PDF job %s failed on attempt %s", doc_id, attempt)
                return
            if not more:
                break

        heartbeat.close()
        try:
            durable_jobs.cleanup_parts(manifest)
        except Exception:
            log.exception("Could not remove temporary PDF parts for %s", doc_id)
        client.delete_message(message.id, heartbeat.receipt)
    finally:
        if heartbeat and heartbeat.thread.is_alive():
            heartbeat.stop.set()
            heartbeat.thread.join()
        try:
            lease.release()
        except HttpResponseError:
            pass


def run_once():
    try:
        worker_lease = durable_jobs.worker_lock_blob().acquire_lease(
            lease_duration=LEASE_SECONDS
        )
    except HttpResponseError as error:
        if error.status_code == 409:
            log.info("Another worker is processing a PDF part")
            return False
        raise

    try:
        client = durable_jobs.queue()
        message = client.receive_message(visibility_timeout=VISIBILITY_SECONDS)
        if message is None:
            return False
        process_message(client, message, worker_lease)
        return True
    finally:
        try:
            worker_lease.release()
        except HttpResponseError:
            pass
