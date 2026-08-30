"""Passive anti-spoofing liveness check via MiniFASNet-V2 (ONNX), per the
user-approved plan — see the Phase 2 plan's "Liveness approach" decision.
Defends against both static-photo and screen-replay attacks from a single
image, unlike blink-detection (which needs video and only catches the
former).

Preprocessing follows the model's documented spec exactly (see
models/README on the Hugging Face export this was fetched from):
face bbox -> 2.7x-scale square crop centered on the bbox -> resize 80x80 ->
BGR, [0,1] range -> HWC to NCHW. Output is a 3-class softmax
[live, print_attack, replay_attack]; liveness score is the live-class
probability directly (equivalently 1 - print - replay, since the three sum
to 1).
"""

import os
from typing import Optional, Tuple

import numpy as np
import onnxruntime

from .schemas import LivenessResult

CROP_SCALE = 2.7
MODEL_INPUT_SIZE = 80
LIVE_THRESHOLD = 0.7  # tunable — not derived from real-world data yet, same
                        # posture as documents.service.ts's confidence threshold

_DEFAULT_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "minifasnet_v2.onnx")
_session: Optional[onnxruntime.InferenceSession] = None


def _get_session() -> onnxruntime.InferenceSession:
    global _session
    if _session is None:
        model_path = os.environ.get("MINIFASNET_MODEL_PATH", _DEFAULT_MODEL_PATH)
        _session = onnxruntime.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    return _session


def crop_with_scale(image: np.ndarray, bbox: Tuple[int, int, int, int], scale: float = CROP_SCALE) -> np.ndarray:
    """bbox is (top, right, bottom, left), dlib's convention. Returns a
    square crop of side `scale * max(box_w, box_h)` centered on the bbox,
    zero-padded if that square extends past the image edges."""
    top, right, bottom, left = bbox
    box_w = right - left
    box_h = bottom - top
    cx = left + box_w / 2
    cy = top + box_h / 2
    size = int(max(box_w, box_h) * scale)
    half = size // 2

    x1, y1 = int(cx - half), int(cy - half)
    x2, y2 = x1 + size, y1 + size

    h, w = image.shape[:2]
    pad_left, pad_top = max(0, -x1), max(0, -y1)
    pad_right, pad_bottom = max(0, x2 - w), max(0, y2 - h)

    if pad_left or pad_top or pad_right or pad_bottom:
        image = np.pad(
            image,
            ((pad_top, pad_bottom), (pad_left, pad_right), (0, 0)),
            mode="constant",
        )
        x1, y1 = x1 + pad_left, y1 + pad_top
        x2, y2 = x2 + pad_left, y2 + pad_top

    return image[y1:y2, x1:x2]


def _preprocess(crop_rgb: np.ndarray) -> np.ndarray:
    from PIL import Image  # Pillow is already a dependency; avoids adding
                             # opencv-python-headless just for a resize.

    resized = np.array(Image.fromarray(crop_rgb).resize((MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)))
    bgr = resized[:, :, ::-1]  # RGB -> BGR per the model's documented input spec
    normalized = bgr.astype(np.float32) / 255.0
    nchw = np.transpose(normalized, (2, 0, 1))[np.newaxis, ...]  # HWC -> NCHW, add batch dim
    return nchw


def check_liveness(image: np.ndarray, bbox: Tuple[int, int, int, int]) -> LivenessResult:
    """`bbox` is the already-detected face location (top, right, bottom,
    left) — callers pass the same bbox face_match.py already computed
    rather than re-running face detection here."""
    crop = crop_with_scale(image, bbox)
    if crop.size == 0:
        return LivenessResult(verdict="UNKNOWN", reason="empty_crop")

    input_tensor = _preprocess(crop)
    session = _get_session()
    input_name = session.get_inputs()[0].name
    output = session.run(None, {input_name: input_tensor})[0]

    probabilities = _softmax(output[0])
    live_score = float(probabilities[0])
    verdict = "LIVE" if live_score >= LIVE_THRESHOLD else "SPOOF"
    return LivenessResult(score=live_score, verdict=verdict)


def _softmax(logits: np.ndarray) -> np.ndarray:
    exp = np.exp(logits - np.max(logits))
    return exp / exp.sum()
