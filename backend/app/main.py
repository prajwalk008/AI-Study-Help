"""Internal RAG service. Only called by Next.js, server-side, with a shared secret."""
import json
import os
import shutil
import threading
import uuid

from fastapi import FastAPI, UploadFile, File, HTTPException, Header, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import config, jobs, store_manager
from .llm import stream_chat
from .rag import RAGEngine
from .vectorstore import qdrant_ready

app = FastAPI(title="Recall RAG service", version="2.0")

engine = RAGEngine()

_ingest_semaphore = threading.Semaphore(config.MAX_CONCURRENT_INGESTS)


def require_secret(x_internal_secret: str = Header(default="")):
    if not config.INTERNAL_API_SECRET or x_internal_secret != config.INTERNAL_API_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


def valid_chat(chat_id: str) -> str:
    if not store_manager.valid_chat_id(chat_id):
        raise HTTPException(status_code=400, detail="Invalid chat_id.")
    return chat_id


class ChatRequest(BaseModel):
    question: str


@app.get("/api/health")
def health():
    return {"status": "ok", "qdrant": qdrant_ready()}


@app.get("/api/documents", dependencies=[Depends(require_secret)])
def documents(chat_id: str = Query(...)):
    valid_chat(chat_id)
    docs = engine.documents(chat_id)
    return {"documents": docs, "total_chunks": sum(d["chunks"] for d in docs)}


def _run_segment_job(
    doc_id: str,
    chat_id: str,
    dest: str,
    filename: str,
    *,
    page_offset: int,
    total_pages: int,
    segment_index: int,
    total_segments: int,
) -> None:
    with _ingest_semaphore:
        jobs.update_job(doc_id, status="running")
        try:
            for evt in engine.ingest_pdf_segment(
                chat_id,
                dest,
                filename,
                doc_id,
                page_offset=page_offset,
                total_pages=total_pages,
                segment_index=segment_index,
                total_segments=total_segments,
            ):
                if evt["type"] == "empty":
                    jobs.update_job(
                        doc_id,
                        status="error",
                        error="No extractable text found (is it a scanned PDF with unreadable images?).",
                    )
                    return
                if evt["type"] == "progress":
                    jobs.update_job(doc_id, stage=evt["stage"], pct=evt["pct"])
                elif evt["type"] == "segment_done":
                    completed = segment_index + 1
                    jobs.update_job(doc_id, completed_segments=completed)
                    if completed >= total_segments:
                        job = jobs.get_job(doc_id) or {}
                        if job.get("total_chunks", 0) == 0:
                            jobs.update_job(
                                doc_id,
                                status="error",
                                error="No extractable text found (is it a scanned PDF with unreadable images?).",
                            )
                            return
                        jobs.update_job(
                            doc_id,
                            status="done",
                            pct=1.0,
                            stage="Indexed",
                            stats={
                                "doc_id": doc_id,
                                "doc_name": filename,
                                "chunks": job.get("total_chunks", 0),
                                "pages": total_pages,
                            },
                        )
                    else:
                        jobs.update_job(
                            doc_id,
                            stage=f"Part {completed}/{total_segments} done",
                        )
        except Exception as e:
            jobs.update_job(doc_id, status="error", error=f"Failed to ingest PDF: {e}")
        finally:
            try:
                os.remove(dest)
            except OSError:
                pass


@app.post("/api/upload/segment", dependencies=[Depends(require_secret)])
async def upload_segment(
    chat_id: str = Query(...),
    filename: str = Query(...),
    segment_index: int = Query(...),
    total_segments: int = Query(...),
    page_offset: int = Query(...),
    total_pages: int = Query(...),
    doc_id: str = Query(default=""),
    file: UploadFile = File(...),
):
    valid_chat(chat_id)
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    if segment_index < 0 or total_segments < 1 or segment_index >= total_segments:
        raise HTTPException(status_code=400, detail="Invalid segment index.")
    if total_pages < 1:
        raise HTTPException(status_code=400, detail="Invalid page count.")

    data = await file.read()
    if len(data) > config.MAX_SEGMENT_BYTES:
        max_mb = config.MAX_SEGMENT_BYTES / (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"Part too large (max {max_mb:g} MB).")

    if not doc_id:
        doc_id = uuid.uuid4().hex[:8]
        jobs.create_job(
            doc_id,
            total_segments=total_segments,
            total_pages=total_pages,
            doc_name=filename,
        )
    else:
        job = jobs.get_job(doc_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Unknown document job.")
        if job.get("completed_segments", 0) != segment_index:
            raise HTTPException(status_code=409, detail="Upload parts in order.")

    dest = os.path.join(config.UPLOAD_DIR, f"{doc_id}_p{segment_index}_{os.path.basename(filename)}")
    with open(dest, "wb") as f:
        f.write(data)

    threading.Thread(
        target=_run_segment_job,
        args=(doc_id, chat_id, dest, filename),
        kwargs={
            "page_offset": page_offset,
            "total_pages": total_pages,
            "segment_index": segment_index,
            "total_segments": total_segments,
        },
        daemon=True,
    ).start()

    return {"doc_id": doc_id}


@app.get("/api/upload/status", dependencies=[Depends(require_secret)])
def upload_status(doc_id: str = Query(...)):
    job = jobs.get_job(doc_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job.")
    return job


@app.post("/api/chat", dependencies=[Depends(require_secret)])
def chat(req: ChatRequest, chat_id: str = Query(...)):
    valid_chat(chat_id)
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    hits = engine.retrieve(chat_id, question)
    messages = engine.build_prompt(question, hits)

    def event_stream():
        sources = [
            {"n": i + 1, "doc_name": m["doc_name"], "page": m["page"],
             "score": round(s, 3), "preview": m["text"][:240]}
            for i, (m, s) in enumerate(hits)
        ]
        yield json.dumps({"type": "sources", "sources": sources}) + "\n"
        for token in stream_chat(messages):
            yield json.dumps({"type": "token", "text": token}) + "\n"
        yield json.dumps({"type": "done"}) + "\n"

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@app.delete("/api/chats/{chat_id}", dependencies=[Depends(require_secret)])
def delete_chat(chat_id: str):
    valid_chat(chat_id)
    with store_manager.get_lock(chat_id):
        store_manager.drop_store(chat_id)
    return {"ok": True}
