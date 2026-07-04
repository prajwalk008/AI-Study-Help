"""Quick smoke test for the embed -> index -> retrieve core (no PDF/LLM needed)."""
import shutil
import tempfile

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

_tmp = tempfile.mkdtemp(prefix="smoke_index_")
store = VectorStore(_tmp)
store.index.add(vecs)
store.metas.extend(c.to_dict() for c in chunks)

q = "How do cells generate energy?"
hits = store.search(embeddings.embed_query(q), k=2)
print(f"\nQuery: {q}")
for meta, score in hits:
    print(f"  score={score:.3f}  p.{meta['page']}  {meta['text'][:60]}")

top2 = " ".join(m["text"] for m, _ in hits)
assert ("Mitochondria" in top2 or "ATP" in top2), "Energy passage missing from top-2!"
assert "Newton" not in top2 and "Revolution" not in top2, "Irrelevant passage leaked into top-2!"
shutil.rmtree(_tmp, ignore_errors=True)
print("\nSMOKE TEST PASSED: semantic retrieval surfaces the right biology passages.")
