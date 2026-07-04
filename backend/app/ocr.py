"""OCR fallback: recover text from image-only PDF pages (scans / photos of books).

Design (interview notes):
- We render a page to a bitmap with PyMuPDF, then run RapidOCR (ONNX) on it. Same ONNX
  runtime we already use for embeddings — no Tesseract system install required, works offline
  (models are bundled in the wheel).
- OCR is expensive, so this only runs as a *fallback* when the PDF's text layer is empty (see
  ingest.py). That "cheap-first, OCR-only-when-needed" hybrid keeps native PDFs fast.
"""
from functools import lru_cache
import numpy as np

from . import config


@lru_cache(maxsize=1)
def _engine():
    # Lazily constructed so the OCR models load only when a scanned page is actually seen.
    from rapidocr_onnxruntime import RapidOCR

    return RapidOCR()


def ocr_page(page) -> str:
    """Render a PyMuPDF page to an image and OCR it into a single text string."""
    pix = page.get_pixmap(dpi=config.OCR_DPI, alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    result, _elapsed = _engine()(img)
    if not result:
        return ""
    # RapidOCR returns [ [box, text, confidence], ... ]; join the recognized lines.
    return " ".join(line[1] for line in result).strip()
