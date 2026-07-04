"""Verifies the OCR fallback works on an image-only PDF (a simulated photo/scan of a page).

We render text onto a bitmap, wrap it in a PDF that has NO text layer, then confirm our
ingest pipeline recovers the words via OCR.
"""
import os
import fitz
from PIL import Image, ImageDraw, ImageFont

from app import ingest

SENTENCE = "Osmosis is the movement of water across a semipermeable membrane."
IMG = "ocr_page.png"
PDF = "scanned_test.pdf"


def make_image_only_pdf():
    img = Image.new("RGB", (1800, 300), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 36)
    except Exception:
        font = ImageFont.load_default()
    draw.text((40, 120), SENTENCE, fill="black", font=font)
    img.save(IMG)

    doc = fitz.open()
    page = doc.new_page(width=1800, height=300)
    page.insert_image(fitz.Rect(0, 0, 1800, 300), filename=IMG)
    doc.save(PDF)
    doc.close()


def main():
    make_image_only_pdf()

    # Sanity check: the PDF genuinely has no text layer.
    doc = fitz.open(PDF)
    raw = (doc[0].get_text() or "").strip()
    doc.close()
    print(f"Embedded text layer length: {len(raw)} chars (expected ~0 for an image-only PDF)")

    pages = ingest.extract_pages(PDF)
    recovered = pages[0]
    print(f"OCR-recovered text: {recovered!r}")

    low = recovered.lower()
    assert "osmosis" in low and "water" in low and "membrane" in low, "OCR did not recover key words!"
    print("\nOCR TEST PASSED: text recovered from an image-only PDF.")

    for f in (IMG, PDF):
        if os.path.exists(f):
            os.remove(f)


if __name__ == "__main__":
    main()
