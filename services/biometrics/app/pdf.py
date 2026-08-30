"""PDF rasterization for reference documents (a passport can be uploaded as
a scanned PDF, per Phase 1) — near-identical to services/ocr/app/pdf.py,
duplicated rather than shared so each sidecar stays self-contained/stateless
(see the Phase 2 plan's reasoning for keeping services/biometrics separate
from services/ocr)."""

from pdf2image import convert_from_bytes


def rasterize_first_page(pdf_bytes: bytes, dpi: int = 300) -> bytes:
    pages = convert_from_bytes(pdf_bytes, dpi=dpi, fmt="jpeg")
    if not pages:
        raise ValueError("PDF has no pages to rasterize")

    import io

    buffer = io.BytesIO()
    pages[0].save(buffer, format="JPEG")
    return buffer.getvalue()
