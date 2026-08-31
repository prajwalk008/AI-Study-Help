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


class PageTailChunker:
    """Prepends the last PAGE_TAIL_WORDS of each page to the next page before chunking."""

    def __init__(
        self,
        doc_id: str,
        doc_name: str,
        *,
        initial_tail: Optional[List[str]] = None,
        chunk_counter: int = 0,
    ):
        self.doc_id = doc_id
        self.doc_name = doc_name
        self.carry_tail: List[str] = list(initial_tail or [])
        self.chunk_counter = chunk_counter

    def process_page(self, page_no: int, page_text: str) -> List[Chunk]:
        page_words = page_text.split()
        if not page_words and not self.carry_tail:
            return []

        words = self.carry_tail + page_words
        chunks: List[Chunk] = []
        for piece in _chunk_words_from_list(
            words, config.CHUNK_SIZE_WORDS, config.CHUNK_OVERLAP_WORDS
        ):
            chunk_id = f"{self.doc_id}_c{self.chunk_counter}"
            self.chunk_counter += 1
            chunks.append(
                Chunk(
                    id=chunk_id,
                    doc_id=self.doc_id,
                    doc_name=self.doc_name,
                    page=page_no,
                    text=piece,
                )
            )

        if page_words:
            n = config.PAGE_TAIL_WORDS
            self.carry_tail = page_words[-n:] if len(page_words) >= n else page_words[:]
        return chunks

    def tail_words(self) -> List[str]:
        return list(self.carry_tail)


def stream_pages(
    pdf_path: str,
    *,
    page_offset: int = 0,
    total_pages: Optional[int] = None,
) -> Iterator[Tuple[int, int, str]]:
    """Yield (global_page_index_0based, total_pages_in_original, page_text)."""
    doc = fitz.open(pdf_path)
    total = total_pages if total_pages is not None else doc.page_count
    try:
        for idx, page in enumerate(doc):
            text = (page.get_text() or "").strip()
            if config.OCR_ENABLED and len(text) < config.MIN_TEXT_CHARS_PER_PAGE:
                ocr_text = ocr.ocr_page(page)
                if len(ocr_text) > len(text):
                    text = ocr_text
            yield page_offset + idx, total, text
    finally:
        doc.close()


def extract_pages(pdf_path: str, on_page: Optional[Callable[[int, int], None]] = None) -> List[str]:
    pages: List[str] = []
    for idx, total, text in stream_pages(pdf_path):
        pages.append(text)
        if on_page:
            on_page(idx, total)
    return pages


def chunk_page(page_text: str, page_no: int, doc_id: str, doc_name: str) -> List[Chunk]:
    chunker = PageTailChunker(doc_id, doc_name)
    return chunker.process_page(page_no, page_text)


def chunks_from_pages(pages: List[str], doc_id: str, doc_name: str) -> List[Chunk]:
    chunker = PageTailChunker(doc_id, doc_name)
    chunks: List[Chunk] = []
    for page_idx, page_text in enumerate(pages):
        chunks.extend(chunker.process_page(page_idx + 1, page_text))
    return chunks


def _chunk_words_from_list(words: List[str], size: int, overlap: int) -> List[str]:
    if not words:
        return []
    chunks = []
    step = max(1, size - overlap)
    for start in range(0, len(words), step):
        window = words[start : start + size]
        if not window:
            break
        chunks.append(" ".join(window))
        if start + size >= len(words):
            break
    return chunks


def _chunk_words(text: str, size: int, overlap: int) -> List[str]:
    return _chunk_words_from_list(text.split(), size, overlap)


def chunk_document(pdf_path: str, doc_id: str, doc_name: str) -> List[Chunk]:
    pages = extract_pages(pdf_path)
    return chunks_from_pages(pages, doc_id, doc_name)

