"""Quick check that embed -> Qdrant -> retrieve works. Needs Qdrant at QDRANT_URL."""
import uuid

from app import embeddings
from app.vectorstore import VectorStore
from app.ingest import Chunk

passages = [
    "Photosynthesis converts light energy into chemical energy stored in glucose.",
    "Mitochondria are the powerhouse of the cell and produce ATP via respiration.",
    "Newton's second law states that force equals mass times acceleration (F=ma).",
    "The French Revolution began in 1789 and led to the fall of the monarchy.",
]
chunks = [Chunk(id=f"c{i}", doc_id="test", doc_name="test.pdf", page=i + 1, text=p)
          for i, p in enumerate(passages)]

print("Embedding passages (first run downloads the ONNX model)...")
vecs = embeddings.embed_passages([c.text for c in chunks])
print("Embeddings shape:", vecs.shape)

chat_id = f"smoketest-{uuid.uuid4().hex[:8]}"
store = VectorStore(chat_id)
store.add(chunks, vecs)

try:
    q = "How do cells generate energy?"
    hits = store.search(embeddings.embed_query(q), k=2)
    print(f"\nQuery: {q}")
    for meta, score in hits:
        print(f"  score={score:.3f}  p.{meta['page']}  {meta['text'][:60]}")

    top2 = " ".join(m["text"] for m, _ in hits)
    assert ("Mitochondria" in top2 or "ATP" in top2), "Energy passage missing from top-2!"
    assert "Newton" not in top2 and "Revolution" not in top2, "Irrelevant passage leaked into top-2!"
    print("\nSMOKE TEST PASSED: semantic retrieval surfaces the right biology passages.")
finally:
    store.delete()
