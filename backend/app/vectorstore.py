"""Qdrant-backed vector store. One shared collection, chats isolated via a chat_id filter."""
import uuid
from typing import List, Tuple
import numpy as np
from qdrant_client import QdrantClient
from qdrant_client.http.models import (
    Distance,
    FieldCondition,
    Filter,
    FilterSelector,
    MatchValue,
    PayloadSchemaType,
    PointStruct,
    VectorParams,
)

from . import config
from .ingest import Chunk

_ID_NAMESPACE = uuid.UUID("12345678-1234-5678-1234-567812345678")

_client: QdrantClient | None = None


def _get_client() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(url=config.QDRANT_URL, api_key=config.QDRANT_API_KEY)
        _ensure_collection(_client)
    return _client


def _ensure_collection(client: QdrantClient) -> None:
    if client.collection_exists(config.QDRANT_COLLECTION):
        return
    client.create_collection(
        collection_name=config.QDRANT_COLLECTION,
        vectors_config=VectorParams(size=config.EMBED_DIM, distance=Distance.COSINE),
    )
    # needed so filtering by chat_id doesn't scan the whole collection
    client.create_payload_index(
        collection_name=config.QDRANT_COLLECTION,
        field_name="chat_id",
        field_schema=PayloadSchemaType.KEYWORD,
    )


def _point_id(chunk_id: str) -> str:
    # qdrant point ids have to be an int or a uuid, our chunk ids aren't
    return str(uuid.uuid5(_ID_NAMESPACE, chunk_id))


def _chat_filter(chat_id: str) -> Filter:
    return Filter(must=[FieldCondition(key="chat_id", match=MatchValue(value=chat_id))])


class VectorStore:
    def __init__(self, chat_id: str):
        self.chat_id = chat_id
        self.client = _get_client()

    def add(self, chunks: List[Chunk], embeddings: np.ndarray):
        points = [
            PointStruct(
                id=_point_id(c.id),
                vector=embeddings[i].tolist(),
                payload={"chat_id": self.chat_id, **c.to_dict()},
            )
            for i, c in enumerate(chunks)
        ]
        self.client.upsert(collection_name=config.QDRANT_COLLECTION, points=points)

    def search(self, query_vec: np.ndarray, k: int) -> List[Tuple[dict, float]]:
        vec = query_vec[0] if query_vec.ndim == 2 else query_vec
        hits = self.client.query_points(
            collection_name=config.QDRANT_COLLECTION,
            query=vec.tolist(),
            query_filter=_chat_filter(self.chat_id),
            limit=k,
            with_payload=True,
        ).points
        return [(h.payload, float(h.score)) for h in hits]

    def documents(self) -> List[dict]:
        docs = {}
        offset = None
        while True:
            points, offset = self.client.scroll(
                collection_name=config.QDRANT_COLLECTION,
                scroll_filter=_chat_filter(self.chat_id),
                limit=256,
                offset=offset,
                with_payload=True,
                with_vectors=False,
            )
            for point in points:
                meta = point.payload
                entry = docs.setdefault(meta["doc_id"], {"doc_id": meta["doc_id"], "doc_name": meta["doc_name"], "chunks": 0})
                entry["chunks"] += 1
            if offset is None:
                break
        return list(docs.values())

    def delete(self) -> None:
        """Wipe every point for this chat (called when a chat is deleted)."""
        self.client.delete(
            collection_name=config.QDRANT_COLLECTION,
            points_selector=FilterSelector(filter=_chat_filter(self.chat_id)),
        )

    @property
    def total_chunks(self) -> int:
        return self.client.count(
            collection_name=config.QDRANT_COLLECTION,
            count_filter=_chat_filter(self.chat_id),
        ).count
