"""OCR fallback for scanned/image-only PDF pages."""
from functools import lru_cache
import numpy as np

from . import config


@lru_cache(maxsize=1)
def _engine():
    from rapidocr_onnxruntime import RapidOCR

    return RapidOCR()


def ocr_page(page) -> str:
    """Render a PyMuPDF page to an image and OCR it into a single text string."""
    pix = page.get_pixmap(dpi=config.OCR_DPI, alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    result, _elapsed = _engine()(img)
    if not result:
        return ""
    # result is [ [box, text, confidence], ... ]
    return " ".join(line[1] for line in result).strip()
