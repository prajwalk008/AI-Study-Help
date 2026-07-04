"""Stage 1 + 2 of the RAG pipeline: ingest PDFs and chunk their text.

Design choices (interview notes):
- We extract text *per page* and keep the page number with every chunk. That page number
  is what lets us show precise citations later ("Answer from p.12").
- We chunk within page boundaries using a sliding word window with overlap. Overlap means a
  sentence sitting on a chunk boundary still appears whole in at least one chunk, so retrieval
  doesn't miss it. Trade-off: overlap duplicates some text (more vectors) for better recall.
"""
from dataclasses import dataclass, asdict
from typing import List, Iterator, Tuple, Optional, Callable
import fitz  # PyMuPDF

from . import config
from . import ocr


@dataclass
class Chunk:
    id: str
    doc_id: str
    doc_name: str
    page: int
    text: str

    def to_dict(self):
        return asdict(self)


def stream_pages(pdf_path: str) -> Iterator[Tuple[int, int, str]]:
    """Yield (page_index, total_pages, page_text) one page at a time.

    Yielding per page (instead of returning the whole list) lets callers report extraction
    progress live — important because OCR on a scanned book is the slow part.
    Hybrid strategy: read the embedded text layer first (fast); if a page is basically empty
    (a scan/photo), fall back to OCR on a rendered image.
    """
    doc = fitz.open(pdf_path)
    total = doc.page_count
    try:
        for idx, page in enumerate(doc):
            text = (page.get_text() or "").strip()
            if config.OCR_ENABLED and len(text) < config.MIN_TEXT_CHARS_PER_PAGE:
                ocr_text = ocr.ocr_page(page)
                if len(ocr_text) > len(text):
                    text = ocr_text
            yield idx, total, text
    finally:
        doc.close()


def extract_pages(pdf_path: str, on_page: Optional[Callable[[int, int], None]] = None) -> List[str]:
    """Return a list of page texts (index 0 == page 1). Calls on_page(index, total) per page."""
    pages: List[str] = []
    for idx, total, text in stream_pages(pdf_path):
        pages.append(text)
        if on_page:
            on_page(idx, total)
    return pages


def chunks_from_pages(pages: List[str], doc_id: str, doc_name: str) -> List[Chunk]:
    """Turn a list of page texts into Chunks, each tagged with its page number."""
    chunks: List[Chunk] = []
    for page_idx, page_text in enumerate(pages):
        page_no = page_idx + 1
        for local_idx, piece in enumerate(
            _chunk_words(page_text, config.CHUNK_SIZE_WORDS, config.CHUNK_OVERLAP_WORDS)
        ):
            chunk_id = f"{doc_id}_p{page_no}_c{local_idx}"
            chunks.append(
                Chunk(id=chunk_id, doc_id=doc_id, doc_name=doc_name, page=page_no, text=piece)
            )
    return chunks


def _chunk_words(text: str, size: int, overlap: int) -> List[str]:
    words = text.split()
    if not words:
        return []
    chunks = []
    step = max(1, size - overlap)
    for start in range(0, len(words), step):
        window = words[start:start + size]
        if not window:
            break
        chunks.append(" ".join(window))
        if start + size >= len(words):
            break
    return chunks


def chunk_document(pdf_path: str, doc_id: str, doc_name: str) -> List[Chunk]:
    """Ingest a PDF into a flat list of Chunks, each tagged with its page number."""
    pages = extract_pages(pdf_path)
    return chunks_from_pages(pages, doc_id, doc_name)
