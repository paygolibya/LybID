"""PDF rasterization — uploaded scanned documents sometimes arrive as PDF
rather than a plain image, and OCR needs a raster image."""

from pdf2image import convert_from_bytes


def rasterize_first_page(pdf_bytes: bytes, dpi: int = 300) -> bytes:
    pages = convert_from_bytes(pdf_bytes, dpi=dpi, fmt="jpeg")
    if not pages:
        raise ValueError("PDF has no pages to rasterize")

    import io

    buffer = io.BytesIO()
    pages[0].save(buffer, format="JPEG")
    return buffer.getvalue()
