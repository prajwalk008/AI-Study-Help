"""Retrieval evaluation harness: measures how good our semantic search actually is.

Why this matters (interview gold): most people *build* RAG but never *measure* it. Two
standard metrics:
  - Recall@k : is the correct passage among the top-k retrieved? (did we even find it?)
  - MRR      : Mean Reciprocal Rank — how high up was the correct passage? (1.0 == always #1)

We build a tiny labelled set: each question has one passage that truly answers it. We embed
everything, run retrieval, and score. Run:  python eval_retrieval.py
"""
import faiss
import numpy as np
from app import embeddings

# (passage_id, text)
PASSAGES = [
    ("photosynthesis", "Photosynthesis converts light energy into chemical energy stored in glucose inside chloroplasts."),
    ("mitochondria", "Mitochondria are the powerhouse of the cell and produce ATP through cellular respiration."),
    ("newton", "Newton's second law states that force equals mass times acceleration, F = m*a."),
    ("french_rev", "The French Revolution began in 1789 and ended the absolute monarchy in France."),
    ("dijkstra", "Dijkstra's algorithm finds the shortest path in a weighted graph using a priority queue."),
    ("http", "HTTP is a stateless protocol where a client sends requests and a server returns responses."),
]

# (question, id_of_the_passage_that_answers_it)
QUERIES = [
    ("How do plants make food from sunlight?", "photosynthesis"),
    ("Which organelle produces ATP energy?", "mitochondria"),
    ("What is the relationship between force, mass and acceleration?", "newton"),
    ("When did the monarchy fall in France?", "french_rev"),
    ("How do you compute the shortest route in a graph?", "dijkstra"),
    ("What kind of protocol is HTTP?", "http"),
]

K = 3


def main():
    ids = [pid for pid, _ in PASSAGES]
    vecs = embeddings.embed_passages([t for _, t in PASSAGES])
    index = faiss.IndexFlatIP(vecs.shape[1])
    index.add(vecs)

    hits_at_k = 0
    reciprocal_ranks = []

    for question, gold_id in QUERIES:
        qv = embeddings.embed_query(question)
        _scores, idxs = index.search(qv, K)
        ranked_ids = [ids[i] for i in idxs[0]]
        if gold_id in ranked_ids:
            hits_at_k += 1
            rank = ranked_ids.index(gold_id) + 1
            reciprocal_ranks.append(1.0 / rank)
        else:
            reciprocal_ranks.append(0.0)
        mark = "OK " if gold_id in ranked_ids else "MISS"
        print(f"[{mark}] '{question[:45]}...' -> top{K}: {ranked_ids}")

    recall = hits_at_k / len(QUERIES)
    mrr = float(np.mean(reciprocal_ranks))
    print(f"\nRecall@{K}: {recall:.3f}   MRR: {mrr:.3f}   ({len(QUERIES)} queries)")


if __name__ == "__main__":
    main()
