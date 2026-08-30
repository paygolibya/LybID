"""Face matching via dlib (through the `face_recognition` wrapper library,
pre-approved in the project's original brief). Face detection runs directly
on the full reference image — a passport scan, not a manually-cropped photo
region — dlib's detector is designed for faces-in-context, not just
headshots.

Real failure modes handled explicitly rather than silently guessed at: zero
faces detected (bad scan, occluded photo) and multiple faces detected (a
real, not just theoretical, risk on the *reference* side too — some
passport designs include a secondary ghost/UV photo, holographic overlay,
or watermark portrait that can register as a second face — not just a
selfie-side risk).
"""

from typing import Optional, Tuple

import face_recognition
import numpy as np

from .schemas import FaceMatchResult

# face_recognition's own documented default for "same person": Euclidean
# distance in the 128-d embedding space. Lower distance = more similar.
DEFAULT_MATCH_THRESHOLD = 0.6


def detect_single_face(image: np.ndarray) -> Tuple[Optional[Tuple[int, int, int, int]], str]:
    """Returns (bbox, reason) — bbox is dlib's (top, right, bottom, left),
    None iff reason explains why (no/multiple faces). Shared by
    extract_face_encoding below and by main.py, which needs the same bbox
    for liveness.check_liveness on the selfie — one detection pass, reused,
    rather than two modules independently re-running face detection."""
    face_locations = face_recognition.face_locations(image)
    if len(face_locations) == 0:
        return None, "no_face_detected"
    if len(face_locations) > 1:
        return None, "multiple_faces_detected"
    return face_locations[0], ""


def extract_face_encoding(image: np.ndarray) -> Tuple[Optional[np.ndarray], str]:
    """Returns (encoding, reason) — encoding is None iff reason explains why."""
    bbox, reason = detect_single_face(image)
    if bbox is None:
        return None, reason

    encodings = face_recognition.face_encodings(image, known_face_locations=[bbox])
    if not encodings:
        return None, "no_face_detected"
    return encodings[0], ""


def match_faces(
    reference_image: np.ndarray,
    selfie_image: np.ndarray,
    threshold: float = DEFAULT_MATCH_THRESHOLD,
) -> FaceMatchResult:
    ref_encoding, ref_reason = extract_face_encoding(reference_image)
    if ref_encoding is None:
        return FaceMatchResult(verdict="UNKNOWN", reason=f"reference_image:{ref_reason}")

    selfie_encoding, selfie_reason = extract_face_encoding(selfie_image)
    if selfie_encoding is None:
        return FaceMatchResult(verdict="UNKNOWN", reason=f"selfie_image:{selfie_reason}")

    distance = float(np.linalg.norm(ref_encoding - selfie_encoding))
    verdict = "MATCH" if distance <= threshold else "NO_MATCH"
    return FaceMatchResult(score=distance, verdict=verdict)
