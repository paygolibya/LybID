import io
import logging

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image

from .face_match import detect_single_face, match_faces
from .liveness import check_liveness
from .pdf import rasterize_first_page
from .schemas import LivenessResult, VerifyResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("lybid-biometrics")

ENGINE_NAME = "dlib-resnet-v1+minifasnet-v2"

app = FastAPI(title="LybID biometrics service", description="Self-hosted face match + liveness sidecar — internal use only")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


def _load_image(raw_bytes: bytes, content_type: str, filename: str) -> np.ndarray:
    is_pdf = (content_type or "").endswith("pdf") or (filename or "").lower().endswith(".pdf")
    if is_pdf:
        try:
            raw_bytes = rasterize_first_page(raw_bytes)
        except Exception as exc:  # noqa: BLE001 — surfaced as 422, not 500
            logger.exception("PDF rasterization failed")
            raise HTTPException(status_code=422, detail=f"Could not rasterize PDF: {exc}") from exc

    try:
        return np.array(Image.open(io.BytesIO(raw_bytes)).convert("RGB"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Could not decode image: {exc}") from exc


@app.post("/verify", response_model=VerifyResponse)
async def verify(
    reference_image: UploadFile = File(...),
    selfie_image: UploadFile = File(...),
) -> VerifyResponse:
    reference_bytes = await reference_image.read()
    selfie_bytes = await selfie_image.read()
    if not reference_bytes or not selfie_bytes:
        raise HTTPException(status_code=400, detail="Both reference_image and selfie_image are required")

    reference_array = _load_image(reference_bytes, reference_image.content_type, reference_image.filename)
    selfie_array = _load_image(selfie_bytes, selfie_image.content_type, selfie_image.filename)

    face_match_result = match_faces(reference_array, selfie_array)

    # Liveness only needs the selfie's face — reuse the same detection
    # shape face_match.py already uses (see detect_single_face's docstring
    # for why this is a second detection pass rather than a shared one).
    selfie_bbox, selfie_reason = detect_single_face(selfie_array)
    if selfie_bbox is None:
        liveness_result = LivenessResult(verdict="UNKNOWN", reason=selfie_reason)
    else:
        liveness_result = check_liveness(selfie_array, selfie_bbox)

    return VerifyResponse(
        faceMatch=face_match_result,
        liveness=liveness_result,
        engine=ENGINE_NAME,
        rawResult={
            "faceMatchThreshold": 0.6,
            "livenessThreshold": 0.7,
        },
    )
