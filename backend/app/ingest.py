"""PDF ingestion + chunking."""
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
    """Yield (page_index, total_pages, page_text) one page at a time."""
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
