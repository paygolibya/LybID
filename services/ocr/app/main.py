import logging

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .birth_certificate import extract_birth_certificate_fields
from .passport import extract_passport_fields
from .pdf import rasterize_first_page
from .preprocessing import load_image, preprocess_for_ocr
from .schemas import ExtractionResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("lybid-ocr")

app = FastAPI(title="LybID OCR service", description="Self-hosted document OCR sidecar — internal use only")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/extract", response_model=ExtractionResponse)
async def extract(document_type: str = Form(...), file: UploadFile = File(...)) -> ExtractionResponse:
    if document_type not in ("PASSPORT", "BIRTH_CERTIFICATE"):
        raise HTTPException(status_code=400, detail=f"Unknown document_type: {document_type}")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    if (file.content_type or "").endswith("pdf") or (file.filename or "").lower().endswith(".pdf"):
        try:
            raw_bytes = rasterize_first_page(raw_bytes)
        except Exception as exc:  # noqa: BLE001 — surfaced as a 422, not a 500
            logger.exception("PDF rasterization failed")
            raise HTTPException(status_code=422, detail=f"Could not rasterize PDF: {exc}") from exc

    try:
        image = load_image(raw_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if document_type == "PASSPORT":
        # PassportEye does its own image loading/preprocessing internally —
        # feed it the raw bytes, not our own preprocessed grayscale image.
        raw_text, fields, overall_confidence = extract_passport_fields(raw_bytes)
    else:
        preprocessed = preprocess_for_ocr(image)
        raw_text, fields, overall_confidence = extract_birth_certificate_fields(preprocessed)

    return ExtractionResponse(rawText=raw_text, fields=fields, overallConfidence=overall_confidence)
