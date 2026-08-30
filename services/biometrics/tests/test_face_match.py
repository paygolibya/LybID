"""Logic-only tests — mocks dlib's face_recognition calls rather than
running real face detection, since a crude synthetic image can't pass a
real face detector the way Phase 1's rendered text fixtures passed
Tesseract (see the Phase 2 plan). Tests the score-thresholding and
zero/multiple-face error handling that's actually LybID's own logic."""

from unittest.mock import patch

import numpy as np

from app.face_match import detect_single_face, extract_face_encoding, match_faces

DUMMY_IMAGE = np.zeros((10, 10, 3), dtype=np.uint8)
BBOX = (0, 10, 10, 0)  # (top, right, bottom, left)
ENCODING_A = np.zeros(128, dtype=np.float64)
ENCODING_B = ENCODING_A.copy()
ENCODING_B[0] = 5.0  # far apart -> distance well above the 0.6 threshold


def test_detect_single_face_returns_bbox_when_exactly_one_found():
    with patch("app.face_match.face_recognition.face_locations", return_value=[BBOX]):
        bbox, reason = detect_single_face(DUMMY_IMAGE)
    assert bbox == BBOX
    assert reason == ""


def test_detect_single_face_reports_zero_faces():
    with patch("app.face_match.face_recognition.face_locations", return_value=[]):
        bbox, reason = detect_single_face(DUMMY_IMAGE)
    assert bbox is None
    assert reason == "no_face_detected"


def test_detect_single_face_reports_multiple_faces():
    with patch("app.face_match.face_recognition.face_locations", return_value=[BBOX, BBOX]):
        bbox, reason = detect_single_face(DUMMY_IMAGE)
    assert bbox is None
    assert reason == "multiple_faces_detected"


def test_extract_face_encoding_success():
    with patch("app.face_match.face_recognition.face_locations", return_value=[BBOX]), patch(
        "app.face_match.face_recognition.face_encodings", return_value=[ENCODING_A]
    ):
        encoding, reason = extract_face_encoding(DUMMY_IMAGE)
    assert encoding is not None
    assert np.array_equal(encoding, ENCODING_A)
    assert reason == ""


def test_match_faces_returns_match_for_identical_encodings():
    with patch("app.face_match.face_recognition.face_locations", return_value=[BBOX]), patch(
        "app.face_match.face_recognition.face_encodings", return_value=[ENCODING_A]
    ):
        result = match_faces(DUMMY_IMAGE, DUMMY_IMAGE)
    assert result.verdict == "MATCH"
    assert result.score == 0.0


def test_match_faces_returns_no_match_for_distant_encodings():
    encodings_by_call = [[ENCODING_A], [ENCODING_B]]
    with patch("app.face_match.face_recognition.face_locations", return_value=[BBOX]), patch(
        "app.face_match.face_recognition.face_encodings", side_effect=lambda *a, **k: encodings_by_call.pop(0)
    ):
        result = match_faces(DUMMY_IMAGE, DUMMY_IMAGE)
    assert result.verdict == "NO_MATCH"
    assert result.score > 0.6


def test_match_faces_returns_unknown_when_reference_has_no_face():
    with patch("app.face_match.face_recognition.face_locations", return_value=[]):
        result = match_faces(DUMMY_IMAGE, DUMMY_IMAGE)
    assert result.verdict == "UNKNOWN"
    assert result.reason == "reference_image:no_face_detected"


def test_match_faces_returns_unknown_when_selfie_has_multiple_faces():
    # First call (reference) succeeds with one face, second (selfie) has two.
    locations_by_call = [[BBOX], [BBOX, BBOX]]
    with patch(
        "app.face_match.face_recognition.face_locations", side_effect=lambda *a, **k: locations_by_call.pop(0)
    ), patch("app.face_match.face_recognition.face_encodings", return_value=[ENCODING_A]):
        result = match_faces(DUMMY_IMAGE, DUMMY_IMAGE)
    assert result.verdict == "UNKNOWN"
    assert result.reason == "selfie_image:multiple_faces_detected"
