"""Application configuration loaded from environment / .env."""
import os
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-small-en-v1.5")

# Shared secret required on every RAG endpoint (Next.js sends it server-side).
INTERNAL_API_SECRET = os.getenv("INTERNAL_API_SECRET", "")

# Vector storage (shared collection, isolated per chat via a payload filter).
# Azure B1: startup.sh runs Qdrant on /home/qdrant/storage and defaults to localhost.
QDRANT_URL = os.getenv("QDRANT_URL", "http://127.0.0.1:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "") or None
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "chunks")
QDRANT_ON_DISK = os.getenv("QDRANT_ON_DISK", "true").lower() in ("1", "true", "yes")

# RAG tuning knobs
CHUNK_SIZE_WORDS = 380
CHUNK_OVERLAP_WORDS = 60
TOP_K = 5
EMBED_DIM = 384             # BAAI/bge-small-en-v1.5 output size

# OCR fallback for scanned PDFs
OCR_ENABLED = True
OCR_DPI = 200
MIN_TEXT_CHARS_PER_PAGE = 20  # below this we assume the page has no real text layer

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")

os.makedirs(UPLOAD_DIR, exist_ok=True)

MAX_UPLOAD_BYTES = 500 * 1024 * 1024
