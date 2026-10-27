"""Process one PDF part, then save a checkpoint before the next part."""
import tempfile
from pathlib import Path

from . import durable_jobs, jobs
from .rag import RAGEngine


def process_next_part(doc_id, state, update, engine=None):
    manifest = durable_jobs.load_manifest(doc_id)
    if manifest is None or not durable_jobs.ready(manifest):
        raise ValueError("PDF parts are missing or incomplete")

    index = state["completed_segments"]
    if index >= manifest["total_segments"]:
        return False

    jobs.create_job(
        doc_id,
        total_segments=manifest["total_segments"],
        total_pages=manifest["total_pages"],
        doc_name=manifest["filename"],
    )
    jobs.update_job(
        doc_id,
        page_tail=state.get("page_tail", []),
        chunk_counter=state.get("chunk_counter", 0),
        total_chunks=state.get("total_chunks", 0),
    )
    engine = engine or RAGEngine()

    try:
        info = durable_jobs.part_info(doc_id, index)
        if info is None:
            raise ValueError("PDF part is missing")
        with tempfile.TemporaryDirectory(prefix="recall-ingest-") as temporary:
            part = Path(temporary) / f"part-{index}.pdf"
            part.write_bytes(durable_jobs.download_part(doc_id, index))
            for event in engine.ingest_pdf_segment(
                manifest["chat_id"], str(part), manifest["filename"], doc_id,
                page_offset=info["page_offset"],
                total_pages=manifest["total_pages"],
                segment_index=index,
                total_segments=manifest["total_segments"],
            ):
                if event["type"] == "progress":
                    update(stage=event["stage"], pct=event["pct"])

        scratch = jobs.get_job(doc_id)
        fields = {
            "completed_segments": index + 1,
            "page_tail": scratch["page_tail"],
            "chunk_counter": scratch["chunk_counter"],
            "total_chunks": scratch["total_chunks"],
            "attempts": 0,
            "error": None,
        }
        if index + 1 == manifest["total_segments"]:
            if scratch["total_chunks"] == 0:
                raise ValueError("No extractable text found in the PDF")
            fields.update({
                "status": "done", "stage": "Indexed", "pct": 1.0,
                "stats": {
                    "doc_id": doc_id, "doc_name": manifest["filename"],
                    "chunks": scratch["total_chunks"], "pages": manifest["total_pages"],
                },
            })
        else:
            fields.update({
                "status": "queued",
                "stage": f"Part {index + 1}/{manifest['total_segments']} indexed",
                "pct": (index + 1) / manifest["total_segments"],
            })
        update(**fields)
        return fields["status"] == "queued"
    finally:
        jobs.delete_job(doc_id)
