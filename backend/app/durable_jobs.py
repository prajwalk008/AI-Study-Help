"""Durable PDF parts and progress, with Azure Queue as the work signal."""
import json
import hashlib
from functools import lru_cache

from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.storage.blob import BlobServiceClient
from azure.storage.queue import QueueServiceClient

from . import config


@lru_cache(maxsize=1)
def container():
    if not config.AZURE_STORAGE_CONNECTION_STRING:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING is not configured")
    service = BlobServiceClient.from_connection_string(config.AZURE_STORAGE_CONNECTION_STRING)
    return service.get_container_client(config.AZURE_BLOB_CONTAINER)


@lru_cache(maxsize=1)
def queue():
    if not config.AZURE_STORAGE_CONNECTION_STRING:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING is not configured")
    service = QueueServiceClient.from_connection_string(config.AZURE_STORAGE_CONNECTION_STRING)
    client = service.get_queue_client(config.AZURE_QUEUE_NAME)
    try:
        client.create_queue()
    except ResourceExistsError:
        pass
    return client


def check_storage():
    """Fail startup when PDF storage is unavailable."""
    container().get_container_properties()
    queue().get_queue_properties()


def _manifest_key(doc_id):
    return f"documents/{doc_id}/manifest.json"


def _part_key(doc_id, index):
    return f"documents/{doc_id}/part-{index:06d}.pdf"


def _state_key(doc_id):
    return f"jobs/{doc_id}.json"


def create_manifest(doc_id, chat_id, filename, total_segments, total_pages):
    manifest = {
        "doc_id": doc_id,
        "chat_id": chat_id,
        "filename": filename,
        "total_segments": total_segments,
        "total_pages": total_pages,
    }
    container().upload_blob(_manifest_key(doc_id), json.dumps(manifest), overwrite=False)
    return manifest


def load_manifest(doc_id):
    try:
        data = container().download_blob(_manifest_key(doc_id)).readall()
    except ResourceNotFoundError:
        return None
    return json.loads(data)


def put_part(doc_id, index, data, page_offset, page_count):
    digest = hashlib.sha256(data).hexdigest()
    try:
        container().upload_blob(
            _part_key(doc_id, index), data, overwrite=False,
            metadata={"pageoffset": str(page_offset), "pagecount": str(page_count), "sha256": digest},
        )
    except ResourceExistsError:
        existing = part_info(doc_id, index)
        if existing != {"page_offset": page_offset, "page_count": page_count, "sha256": digest}:
            raise ValueError("Upload part already exists with different content")


def part_info(doc_id, index):
    try:
        properties = container().get_blob_client(_part_key(doc_id, index)).get_blob_properties()
    except ResourceNotFoundError:
        return None
    return {
        "page_offset": int(properties.metadata["pageoffset"]),
        "page_count": int(properties.metadata["pagecount"]),
        "sha256": properties.metadata["sha256"],
    }


def ready(manifest):
    page = 0
    for index in range(manifest["total_segments"]):
        info = part_info(manifest["doc_id"], index)
        if info is None or info["page_offset"] != page:
            return False
        page += info["page_count"]
    return page == manifest["total_pages"]


def download_part(doc_id, index):
    return container().download_blob(_part_key(doc_id, index)).readall()


def cleanup_parts(manifest):
    for index in range(manifest["total_segments"]):
        try:
            container().delete_blob(_part_key(manifest["doc_id"], index))
        except ResourceNotFoundError:
            pass


def state_blob(doc_id):
    return container().get_blob_client(_state_key(doc_id))


def worker_lock_blob():
    blob = container().get_blob_client("locks/worker")
    try:
        blob.upload_blob(b"", overwrite=False)
    except ResourceExistsError:
        pass
    return blob


def initial_state(manifest):
    return {
        "status": "queued", "stage": "Queued", "pct": 0.0,
        "completed_segments": 0, "total_chunks": 0, "chunk_counter": 0,
        "page_tail": [], "attempts": 0, "stats": None, "error": None,
    }


def load_state(doc_id):
    try:
        return json.loads(state_blob(doc_id).download_blob().readall())
    except ResourceNotFoundError:
        return None


def ensure_state(manifest):
    doc_id = manifest["doc_id"]
    try:
        state_blob(doc_id).upload_blob(json.dumps(initial_state(manifest)), overwrite=False)
    except ResourceExistsError:
        pass
    return load_state(doc_id)


def save_state(doc_id, state, lease):
    state_blob(doc_id).upload_blob(json.dumps(state), overwrite=True, lease=lease)


def enqueue_document(manifest):
    queue().send_message(manifest["doc_id"], time_to_live=-1)
    ensure_state(manifest)


def recover_pending():
    """Reissue work signals after a crash between saving state and queueing."""
    pending = 0
    for blob in container().list_blobs(name_starts_with="jobs/"):
        doc_id = blob.name.removeprefix("jobs/").removesuffix(".json")
        state = load_state(doc_id)
        if state and state["status"] in ("queued", "running"):
            queue().send_message(doc_id, time_to_live=-1)
            pending += 1
    return pending
