"""Application configuration loaded from environment / .env."""
import os
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-small-en-v1.5")

# Shared secret required on every RAG endpoint (Next.js sends it server-side).
INTERNAL_API_SECRET = os.getenv("INTERNAL_API_SECRET", "")

# RAG tuning knobs (exposed so their trade-offs are explicit and defensible)
CHUNK_SIZE_WORDS = 380      # ~500 tokens: big enough for context, small enough to stay specific
CHUNK_OVERLAP_WORDS = 60    # ~80 tokens: preserves meaning across chunk boundaries
TOP_K = 5                   # how many chunks we feed the LLM as grounding context
EMBED_DIM = 384             # dimensionality of BAAI/bge-small-en-v1.5

# OCR fallback (for scanned PDFs / photos of book pages that have no text layer)
OCR_ENABLED = True
OCR_DPI = 200               # higher = better OCR accuracy but slower / more memory
MIN_TEXT_CHARS_PER_PAGE = 20  # below this, treat the page as image-only and run OCR

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
INDEX_DIR = os.path.join(DATA_DIR, "index")
INDEX_PATH = os.path.join(INDEX_DIR, "faiss.index")
META_PATH = os.path.join(INDEX_DIR, "meta.json")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(INDEX_DIR, exist_ok=True)
