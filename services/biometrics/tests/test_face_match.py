"""Logic-only tests — mocks dlib's face_recognition calls rather than
running real face detection, since a crude synthetic image can't pass a
real face detector the way Phase 1's rendered text fixtures passed
Tesseract (see the Phase 2 plan). Tests the score-thresholding and
zero/multiple-face error handling that's actually LybID's own logic."""

from unittest.mock import patch

import numpy as np

from app.face_match import (
    detect_single_face,
    detect_single_face_any_rotation,
    extract_face_encoding,
    match_faces,
)

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


def test_detect_single_face_any_rotation_succeeds_immediately_when_unrotated_works():
    with patch("app.face_match.detect_single_face", return_value=(BBOX, "")) as mock_detect:
        rotated, bbox, reason = detect_single_face_any_rotation(DUMMY_IMAGE)
    assert bbox == BBOX
    assert reason == ""
    mock_detect.assert_called_once()  # no wasted rotation attempts on the common case


def test_detect_single_face_any_rotation_falls_back_through_rotations():
    # First two orientations (0, 90) find nothing; the third (180) does —
    # e.g. a sideways-scanned passport page.
    results = [(None, "no_face_detected"), (None, "no_face_detected"), (BBOX, "")]
    with patch("app.face_match.detect_single_face", side_effect=results) as mock_detect:
        rotated, bbox, reason = detect_single_face_any_rotation(DUMMY_IMAGE)
    assert bbox == BBOX
    assert reason == ""
    assert mock_detect.call_count == 3


def test_detect_single_face_any_rotation_reports_last_reason_when_all_four_fail():
    results = [
        (None, "no_face_detected"),
        (None, "no_face_detected"),
        (None, "no_face_detected"),
        (None, "multiple_faces_detected"),
    ]
    with patch("app.face_match.detect_single_face", side_effect=results) as mock_detect:
        rotated, bbox, reason = detect_single_face_any_rotation(DUMMY_IMAGE)
    assert bbox is None
    assert reason == "multiple_faces_detected"
    assert mock_detect.call_count == 4


def test_extract_face_encoding_success():
    with patch(
        "app.face_match.detect_single_face_any_rotation", return_value=(DUMMY_IMAGE, BBOX, "")
    ), patch("app.face_match.face_recognition.face_encodings", return_value=[ENCODING_A]):
        encoding, reason = extract_face_encoding(DUMMY_IMAGE)
    assert encoding is not None
    assert np.array_equal(encoding, ENCODING_A)
    assert reason == ""


def test_extract_face_encoding_propagates_detection_failure_reason():
    with patch(
        "app.face_match.detect_single_face_any_rotation",
        return_value=(DUMMY_IMAGE, None, "no_face_detected"),
    ):
        encoding, reason = extract_face_encoding(DUMMY_IMAGE)
    assert encoding is None
    assert reason == "no_face_detected"


def test_match_faces_returns_match_for_identical_encodings():
    with patch("app.face_match.extract_face_encoding", return_value=(ENCODING_A, "")):
        result = match_faces(DUMMY_IMAGE, DUMMY_IMAGE)
    assert result.verdict == "MATCH"
    assert result.score == 0.0


def test_match_faces_returns_no_match_for_distant_encodings():
    encodings_by_call = [(ENCODING_A, ""), (ENCODING_B, "")]
    with patch(
        "app.face_match.extract_face_encoding", side_effect=lambda *a, **k: encodings_by_call.pop(0)
    ):
        result = match_faces(DUMMY_IMAGE, DUMMY_IMAGE)
    assert result.verdict == "NO_MATCH"
    assert result.score > 0.6


def test_match_faces_returns_unknown_when_reference_has_no_face():
    with patch("app.face_match.extract_face_encoding", return_value=(None, "no_face_detected")):
        result = match_faces(DUMMY_IMAGE, DUMMY_IMAGE)
    assert result.verdict == "UNKNOWN"
    assert result.reason == "reference_image:no_face_detected"


def test_match_faces_returns_unknown_when_selfie_has_multiple_faces():
    # First call (reference) succeeds with one face, second (selfie) has two.
    results_by_call = [(ENCODING_A, ""), (None, "multiple_faces_detected")]
    with patch(
        "app.face_match.extract_face_encoding", side_effect=lambda *a, **k: results_by_call.pop(0)
    ):
        result = match_faces(DUMMY_IMAGE, DUMMY_IMAGE)
    assert result.verdict == "UNKNOWN"
    assert result.reason == "selfie_image:multiple_faces_detected"
