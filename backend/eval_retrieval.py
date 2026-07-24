"""Checks retrieval quality with Recall@k and MRR against a small labeled set. Run directly."""
import numpy as np
from app import embeddings

PASSAGES = [
    ("photosynthesis", "Photosynthesis converts light energy into chemical energy stored in glucose inside chloroplasts."),
    ("mitochondria", "Mitochondria are the powerhouse of the cell and produce ATP through cellular respiration."),
    ("newton", "Newton's second law states that force equals mass times acceleration, F = m*a."),
    ("french_rev", "The French Revolution began in 1789 and ended the absolute monarchy in France."),
    ("dijkstra", "Dijkstra's algorithm finds the shortest path in a weighted graph using a priority queue."),
    ("http", "HTTP is a stateless protocol where a client sends requests and a server returns responses."),
]

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

    hits_at_k = 0
    reciprocal_ranks = []

    for question, gold_id in QUERIES:
        qv = embeddings.embed_query(question)
        # Vectors are L2-normalized, so a plain dot product is cosine similarity.
        scores = vecs @ qv[0]
        top_idxs = np.argsort(-scores)[:K]
        ranked_ids = [ids[i] for i in top_idxs]
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
