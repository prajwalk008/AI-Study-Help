"""Internal RAG service. Only called by Next.js, server-side, with a shared secret."""
import json
import os
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


@app.post("/api/upload", dependencies=[Depends(require_secret)])
async def upload(chat_id: str = Query(...), file: UploadFile = File(...)):
    valid_chat(chat_id)
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    safe_name = f"{uuid.uuid4().hex[:8]}_{os.path.basename(file.filename)}"
    dest = os.path.join(config.UPLOAD_DIR, safe_name)
    with open(dest, "wb") as f:
        f.write(await file.read())

    def event_stream():
        try:
            for evt in engine.ingest_pdf_stream(chat_id, dest, file.filename):
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
