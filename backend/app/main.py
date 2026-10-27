"""Internal RAG service. Only called by Next.js, server-side, with a shared secret."""
from contextlib import asynccontextmanager
import json
import re
import uuid
import fitz
from azure.core.exceptions import ResourceExistsError

from fastapi import FastAPI, UploadFile, File, HTTPException, Header, Depends, Query
from fastapi.responses import StreamingResponse
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from . import config, durable_jobs, embeddings, store_manager
from .llm import stream_chat
from .rag import RAGEngine

@asynccontextmanager
async def lifespan(_app):
    if config.AZURE_STORAGE_CONNECTION_STRING:
        await run_in_threadpool(durable_jobs.check_storage)
    yield


app = FastAPI(title="Recall RAG service", version="2.0", lifespan=lifespan)

engine = RAGEngine()

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
    return {"status": "ok", "build_sha": config.BUILD_SHA}


@app.get("/api/warm", dependencies=[Depends(require_secret)])
def warm():
    embeddings.embed_query("ready")
    return {"status": "ok"}


@app.get("/api/documents", dependencies=[Depends(require_secret)])
def documents(chat_id: str = Query(...)):
    valid_chat(chat_id)
    docs = engine.documents(chat_id)
    return {"documents": docs, "total_chunks": sum(d["chunks"] for d in docs)}


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
    if page_offset < 0 or page_offset >= total_pages:
        raise HTTPException(status_code=400, detail="Invalid page offset.")

    data = await file.read()
    if len(data) > config.MAX_SEGMENT_BYTES:
        max_mb = config.MAX_SEGMENT_BYTES / (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"Part too large (max {max_mb:g} MB).")

    try:
        with fitz.open(stream=data, filetype="pdf") as pdf:
            page_count = pdf.page_count
    except Exception as error:
        raise HTTPException(status_code=400, detail="Invalid PDF part.") from error
    if not page_count or page_offset + page_count > total_pages:
        raise HTTPException(status_code=400, detail="PDF page range is invalid.")

    if not doc_id:
        if segment_index != 0 or page_offset != 0:
            raise HTTPException(status_code=409, detail="Upload the first part first.")
        doc_id = uuid.uuid4().hex
    else:
        if not re.fullmatch(r"[0-9a-f]{32}", doc_id):
            raise HTTPException(status_code=400, detail="Invalid document ID.")

    manifest = await run_in_threadpool(durable_jobs.load_manifest, doc_id)
    if manifest is None:
        if segment_index != 0 or page_offset != 0:
            raise HTTPException(status_code=409, detail="Upload the first part first.")
        try:
            manifest = await run_in_threadpool(
                durable_jobs.create_manifest,
                doc_id, chat_id, filename, total_segments, total_pages
            )
        except ResourceExistsError:
            manifest = await run_in_threadpool(durable_jobs.load_manifest, doc_id)
    if manifest is None or manifest["chat_id"] != chat_id:
        raise HTTPException(status_code=404, detail="Unknown document upload.")
    if (manifest["filename"] != filename or
            manifest["total_segments"] != total_segments or
            manifest["total_pages"] != total_pages):
        raise HTTPException(status_code=409, detail="Upload details changed.")
    if await run_in_threadpool(durable_jobs.load_state, doc_id) is not None:
        return {"doc_id": doc_id}

    expected_offset = 0
    for previous in range(segment_index):
        info = await run_in_threadpool(durable_jobs.part_info, doc_id, previous)
        if info is None or info["page_offset"] != expected_offset:
            raise HTTPException(status_code=409, detail="Upload parts in order.")
        expected_offset += info["page_count"]
    if page_offset != expected_offset:
        raise HTTPException(status_code=409, detail="Page offset does not match earlier parts.")
    try:
        await run_in_threadpool(
            durable_jobs.put_part, doc_id, segment_index, data, page_offset, page_count
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error

    if segment_index + 1 == total_segments:
        if not await run_in_threadpool(durable_jobs.ready, manifest):
            raise HTTPException(status_code=409, detail="PDF parts are incomplete.")
        try:
            await run_in_threadpool(durable_jobs.enqueue_document, manifest)
        except Exception as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    return {"doc_id": doc_id}


@app.get("/api/upload/status", dependencies=[Depends(require_secret)])
def upload_status(doc_id: str = Query(...)):
    if not re.fullmatch(r"[0-9a-f]{32}", doc_id):
        raise HTTPException(status_code=400, detail="Invalid document ID.")
    try:
        state = durable_jobs.load_state(doc_id)
        if state is None:
            manifest = durable_jobs.load_manifest(doc_id)
            if manifest is None:
                raise HTTPException(status_code=404, detail="Unknown document upload.")
            if durable_jobs.ready(manifest):
                durable_jobs.enqueue_document(manifest)
                state = durable_jobs.load_state(doc_id)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    if state is None:
        return {"status": "uploading", "stage": "Uploading PDF parts", "pct": 0,
                "completed_segments": 0, "stats": None, "error": None}
    return {
        "status": state["status"],
        "stage": state["stage"],
        "pct": state["pct"],
        "completed_segments": state["completed_segments"],
        "stats": state["stats"],
        "error": state["error"],
    }


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
