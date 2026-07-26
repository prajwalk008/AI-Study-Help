"""Internal RAG service. Only called by Next.js, server-side, with a shared secret."""
import json
import os
import shutil
import uuid

from fastapi import FastAPI, UploadFile, File, HTTPException, Header, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import config, store_manager
from .llm import stream_chat
from .rag import RAGEngine

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
    return {"status": "ok"}


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
        raise HTTPException(status_code=413, detail="File too large (max 25 MB).")

    with open(os.path.join(chunk_dir, f"{index:05d}.part"), "wb") as f:
        f.write(data)

    return {"ok": True}


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

    safe_name = f"{uuid.uuid4().hex[:8]}_{os.path.basename(filename)}"
    dest = os.path.join(config.UPLOAD_DIR, safe_name)
    with open(dest, "wb") as out:
        for part_path in parts:
            with open(part_path, "rb") as part:
                out.write(part.read())
    shutil.rmtree(chunk_dir, ignore_errors=True)

    def event_stream():
        try:
            for evt in engine.ingest_pdf_stream(chat_id, dest, filename):
                if evt.get("type") == "empty":
                    yield json.dumps({
                        "type": "error",
                        "detail": "No extractable text found (is it a scanned PDF with unreadable images?).",
                    }) + "\n"
                    return
                yield json.dumps(evt) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "detail": f"Failed to ingest PDF: {e}"}) + "\n"
        finally:
            try:
                os.remove(dest)
            except OSError:
                pass

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


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
