"""Application configuration loaded from environment / .env."""
import os
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-small-en-v1.5")

# Shared secret required on every RAG endpoint (Next.js sends it server-side).
INTERNAL_API_SECRET = os.getenv("INTERNAL_API_SECRET", "")
AZURE_STORAGE_CONNECTION_STRING = os.getenv("AZURE_STORAGE_CONNECTION_STRING", "")
AZURE_BLOB_CONTAINER = os.getenv("AZURE_BLOB_CONTAINER", "recall-uploads")
AZURE_QUEUE_NAME = os.getenv("AZURE_QUEUE_NAME", "recall-ingest")
BUILD_SHA = os.getenv("BUILD_SHA", "")

# Qdrant Cloud: vector storage (shared collection, isolated per chat via a payload filter).
QDRANT_URL = os.getenv("QDRANT_URL", "")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "chunks")
# Base64 of 32 random bytes. Locks passage text stored in Qdrant.
QDRANT_PAYLOAD_KEY = os.getenv("QDRANT_PAYLOAD_KEY", "")

# RAG tuning knobs
CHUNK_SIZE_WORDS = 380
CHUNK_OVERLAP_WORDS = 60
TOP_K = 5
EMBED_DIM = 384             # BAAI/bge-small-en-v1.5 output size

# OCR fallback for scanned PDFs
OCR_ENABLED = True
OCR_DPI = 200
MIN_TEXT_CHARS_PER_PAGE = 20  # below this we assume the page has no real text layer

# Browser splits before upload; each part must be <= 4 MB.
MAX_SEGMENT_BYTES = 4 * 1024 * 1024

# Last N words of each page are prepended to the next page (and carried across parts).
PAGE_TAIL_WORDS = 120

# Smaller batches reduce peak RAM usage in the backend container.
INGEST_BATCH_SIZE = int(os.getenv("INGEST_BATCH_SIZE", "50"))
