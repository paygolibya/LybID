"""Passive anti-spoofing liveness check via MiniFASNet (ONNX), per the
user-approved plan — see the Phase 2 plan's "Liveness approach" decision.
Defends against both static-photo and screen-replay attacks from a single
image, unlike blink-detection (which needs video and only catches the
former).

Uses the official minivision-ai/Silent-Face-Anti-Spoofing project's own
two-model ensemble, not a single model — this is not optional. The project's
own demo (test.py) never scores a face with one model alone: it runs the
same face crop through both a 2.7x-scale model (MiniFASNetV2) and a
4.0x-scale model (MiniFASNetV1SE), sums their 3-class softmax outputs, and
averages. A single model alone was verified (during this project's own
integration work) to confidently misclassify a real, live, human-verified
selfie as non-live — every input tested (a genuine selfie, random noise,
all-zeros, all-ones) produced nearly the same output, which is what
motivated tracking this ensemble requirement down to the official source
rather than trusting either of two independent community single-model ONNX
re-exports (both of which turned out to be non-functional — see README).

Class-index convention verified directly from the official repo's own
test.py, NOT from a third-party model card (an earlier, wrong assumption
here was "index 0 = live", taken from a Hugging Face re-export's README):
label index 1 is real/live; 0 and 2 are both fake (print vs. replay attack,
respectively) and are never distinguished in the final decision.

Preprocessing (resize 80x80, BGR, [0,1] range, HWC->NCHW) and the crop
geometry (crop_with_scale, below) both replicate the official pipeline
exactly — see each function's own docstring for the specific source this
was checked against.
"""

import os
from typing import Optional, Tuple

import numpy as np
import onnxruntime

from .schemas import LivenessResult

MODEL_INPUT_SIZE = 80
LIVE_CLASS_INDEX = 1

# (scale, model filename) pairs — mirrors the two models the official demo
# ensembles. Order doesn't matter for the average, but keeping both scale
# and filename paired here (rather than as separate parallel lists) makes
# it obvious which crop scale belongs to which checkpoint.
_ENSEMBLE_MODELS: Tuple[Tuple[float, str], ...] = (
    (2.7, "minifasnet_v2.onnx"),
    (4.0, "minifasnet_v1se_4.0.onnx"),
)

_MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
_sessions: Optional[Tuple[onnxruntime.InferenceSession, ...]] = None


def _get_sessions() -> Tuple[Tuple[float, onnxruntime.InferenceSession], ...]:
    global _sessions
    if _sessions is None:
        models_dir = os.environ.get("MINIFASNET_MODELS_DIR", _MODELS_DIR)
        _sessions = tuple(
            onnxruntime.InferenceSession(
                os.path.join(models_dir, filename), providers=["CPUExecutionProvider"]
            )
            for _scale, filename in _ENSEMBLE_MODELS
        )
    return tuple(zip((scale for scale, _ in _ENSEMBLE_MODELS), _sessions))


def crop_with_scale(image: np.ndarray, bbox: Tuple[int, int, int, int], scale: float) -> np.ndarray:
    """bbox is (top, right, bottom, left), dlib's convention. Replicates
    the official Silent-Face-Anti-Spoofing project's own CropImage._get_new_box
    exactly (src/generate_patches.py) — NOT a zero-padded square crop, which
    was this project's own earlier (incorrect) assumption. The official
    algorithm centers a `scale`x expansion of the bbox, then: (a) caps
    `scale` so the expansion can never exceed the image bounds, and (b) if
    the centered box still hangs off an edge, *shifts* the box inward to
    keep the full requested size on-image rather than padding. The model
    was calibrated against this exact convention; a zero-padded crop is a
    meaningfully different image to it."""
    top, right, bottom, left = bbox
    x, y = left, top
    box_w, box_h = right - left, bottom - top
    src_h, src_w = image.shape[:2]

    if box_w <= 0 or box_h <= 0:
        # Degenerate bbox (e.g. a detector returning a zero-area box) — the
        # official algorithm's scale formula divides by box_w/box_h and
        # would raise ZeroDivisionError; return an empty crop instead, same
        # as this always has, so check_liveness's empty_crop path handles it.
        return image[0:0, 0:0]

    scale = min((src_h - 1) / box_h, min((src_w - 1) / box_w, scale))
    new_width = box_w * scale
    new_height = box_h * scale
    center_x, center_y = box_w / 2 + x, box_h / 2 + y

    left_top_x = center_x - new_width / 2
    left_top_y = center_y - new_height / 2
    right_bottom_x = center_x + new_width / 2
    right_bottom_y = center_y + new_height / 2

    if left_top_x < 0:
        right_bottom_x -= left_top_x
        left_top_x = 0
    if left_top_y < 0:
        right_bottom_y -= left_top_y
        left_top_y = 0
    if right_bottom_x > src_w - 1:
        left_top_x -= right_bottom_x - src_w + 1
        right_bottom_x = src_w - 1
    if right_bottom_y > src_h - 1:
        left_top_y -= right_bottom_y - src_h + 1
        right_bottom_y = src_h - 1

    x1, y1 = int(left_top_x), int(left_top_y)
    x2, y2 = int(right_bottom_x), int(right_bottom_y)
    return image[y1 : y2 + 1, x1 : x2 + 1]


def _preprocess(crop_rgb: np.ndarray) -> np.ndarray:
    from PIL import Image  # Pillow is already a dependency; avoids adding
                             # opencv-python-headless just for a resize.

    # BILINEAR to match the official pipeline's cv2.resize (OpenCV's default
    # interpolation is INTER_LINEAR) — not Pillow's own resize default.
    resized = np.array(
        Image.fromarray(crop_rgb).resize((MODEL_INPUT_SIZE, MODEL_INPUT_SIZE), resample=Image.BILINEAR)
    )
    bgr = resized[:, :, ::-1]  # RGB -> BGR per the model's documented input spec
    normalized = bgr.astype(np.float32) / 255.0
    nchw = np.transpose(normalized, (2, 0, 1))[np.newaxis, ...]  # HWC -> NCHW, add batch dim
    return nchw


def _run_one(session: onnxruntime.InferenceSession, image: np.ndarray, bbox, scale: float) -> Optional[np.ndarray]:
    """Returns the 3-class softmax for one ensemble member, or None if this
    scale's crop was degenerate (only possible if the *other* member's
    crop wasn't — same bbox, different scale, so this is a defensive
    fallback rather than an expected path)."""
    crop = crop_with_scale(image, bbox, scale=scale)
    if crop.size == 0:
        return None
    input_tensor = _preprocess(crop)
    input_name = session.get_inputs()[0].name
    output = session.run(None, {input_name: input_tensor})[0]
    return _softmax(output[0])


def check_liveness(image: np.ndarray, bbox: Tuple[int, int, int, int]) -> LivenessResult:
    """`bbox` is the already-detected face location (top, right, bottom,
    left) — callers pass the same bbox face_match.py already computed
    rather than re-running face detection here.

    Ensembles both MiniFASNet scale variants (see module docstring) exactly
    as the official demo does: average each model's 3-class softmax, then
    the live-class (index 1) probability of that average is both the
    reported score and (thresholded) the verdict."""
    probs_per_model = []
    for scale, session in _get_sessions():
        probs = _run_one(session, image, bbox, scale)
        if probs is None:
            return LivenessResult(verdict="UNKNOWN", reason="empty_crop")
        probs_per_model.append(probs)

    averaged = np.mean(probs_per_model, axis=0)
    live_score = float(averaged[LIVE_CLASS_INDEX])
    # Matches the official demo's own decision rule exactly (argmax of the
    # averaged distribution, real iff the winning class is index 1) rather
    # than an independently-chosen probability cutoff.
    verdict = "LIVE" if int(np.argmax(averaged)) == LIVE_CLASS_INDEX else "SPOOF"
    return LivenessResult(score=live_score, verdict=verdict)


def _softmax(logits: np.ndarray) -> np.ndarray:
    exp = np.exp(logits - np.max(logits))
    return exp / exp.sum()
