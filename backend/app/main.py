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


def require_secret(x_internal_secret: str = Header(default="")):
    """Reject any caller that doesn't present the shared internal secret."""
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


def valid_upload(upload_id: str) -> str:
    if not store_manager.valid_upload_id(upload_id):
        raise HTTPException(status_code=400, detail="Invalid upload_id.")
    return upload_id


@app.post("/api/upload/chunk", dependencies=[Depends(require_secret)])
async def upload_chunk(
    upload_id: str = Query(...),
    index: int = Query(...),
    total: int = Query(...),
    chunk: UploadFile = File(...),
):
    valid_upload(upload_id)
    if index < 0 or total < 1 or index >= total:
        raise HTTPException(status_code=400, detail="Invalid chunk index.")

    chunk_dir = os.path.join(config.UPLOAD_DIR, upload_id)
    os.makedirs(chunk_dir, exist_ok=True)
    data = await chunk.read()

    existing = sum(os.path.getsize(os.path.join(chunk_dir, f)) for f in os.listdir(chunk_dir))
    if existing + len(data) > config.MAX_UPLOAD_BYTES:
        shutil.rmtree(chunk_dir, ignore_errors=True)
        max_mb = config.MAX_UPLOAD_BYTES // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"File too large (max {max_mb} MB).")

    with open(os.path.join(chunk_dir, f"{index:05d}.part"), "wb") as f:
        f.write(data)

    return {"ok": True}


def _run_ingest_job(doc_id: str, chat_id: str, dest: str, filename: str) -> None:
    jobs.update_job(doc_id, status="running")
    try:
        for evt in engine.ingest_pdf_stream(chat_id, dest, filename, doc_id):
            if evt["type"] == "empty":
                jobs.update_job(
                    doc_id,
                    status="error",
                    error="No extractable text found (is it a scanned PDF with unreadable images?).",
                )
                return
            if evt["type"] == "progress":
                jobs.update_job(doc_id, stage=evt["stage"], pct=evt["pct"])
            elif evt["type"] == "done":
                jobs.update_job(doc_id, status="done", pct=1.0, stats=evt["stats"])
    except Exception as e:
        jobs.update_job(doc_id, status="error", error=f"Failed to ingest PDF: {e}")
    finally:
        try:
            os.remove(dest)
        except OSError:
            pass


@app.post("/api/upload/finish", dependencies=[Depends(require_secret)])
async def upload_finish(
    chat_id: str = Query(...),
    upload_id: str = Query(...),
    filename: str = Query(...),
    total: int = Query(...),
):
    valid_chat(chat_id)
    valid_upload(upload_id)
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    chunk_dir = os.path.join(config.UPLOAD_DIR, upload_id)
    parts = [os.path.join(chunk_dir, f"{i:05d}.part") for i in range(total)]
    if not all(os.path.isfile(p) for p in parts):
        shutil.rmtree(chunk_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail="Upload incomplete.")

    doc_id = uuid.uuid4().hex[:8]
    dest = os.path.join(config.UPLOAD_DIR, f"{doc_id}_{os.path.basename(filename)}")
    with open(dest, "wb") as out:
        for part_path in parts:
            with open(part_path, "rb") as part:
                out.write(part.read())
    shutil.rmtree(chunk_dir, ignore_errors=True)

    jobs.create_job(doc_id)
    threading.Thread(target=_run_ingest_job, args=(doc_id, chat_id, dest, filename), daemon=True).start()
    return {"doc_id": doc_id, "bytes": os.path.getsize(dest)}


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
