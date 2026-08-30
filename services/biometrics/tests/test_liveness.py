"""Logic-only tests. crop_with_scale is pure geometry, tested directly with
synthetic arrays. check_liveness mocks the ONNX session — no real model
inference needed to test the threshold/verdict logic that's actually
LybID's own code."""

from unittest.mock import MagicMock, patch

import numpy as np

from app.liveness import CROP_SCALE, LIVE_THRESHOLD, check_liveness, crop_with_scale


def test_crop_with_scale_no_padding_needed():
    image = np.zeros((200, 200, 3), dtype=np.uint8)
    bbox = (50, 150, 150, 50)  # top, right, bottom, left — 100x100 box, centered
    crop = crop_with_scale(image, bbox, scale=1.0)
    assert crop.shape[0] == 100
    assert crop.shape[1] == 100


def test_crop_with_scale_pads_when_scaled_box_exceeds_image_bounds():
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    bbox = (40, 60, 60, 40)  # 20x20 box near the center
    crop = crop_with_scale(image, bbox, scale=CROP_SCALE)
    expected_size = int(20 * CROP_SCALE)
    assert crop.shape[0] == expected_size
    assert crop.shape[1] == expected_size


def test_crop_with_scale_handles_bbox_at_image_corner():
    image = np.ones((50, 50, 3), dtype=np.uint8)
    bbox = (0, 10, 10, 0)  # top-left corner
    crop = crop_with_scale(image, bbox, scale=2.0)
    # Should not raise, and should produce a square crop of the expected size
    assert crop.shape[0] == crop.shape[1] == 20


def _mock_session(live_logit: float, spoof_logit: float, replay_logit: float) -> MagicMock:
    session = MagicMock()
    input_meta = MagicMock()
    input_meta.name = "input"
    session.get_inputs.return_value = [input_meta]
    session.run.return_value = [np.array([[live_logit, spoof_logit, replay_logit]])]
    return session


def test_check_liveness_returns_live_above_threshold():
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    bbox = (10, 90, 90, 10)
    # Logits chosen so softmax puts ~0.9 probability on the live class.
    session = _mock_session(live_logit=5.0, spoof_logit=0.5, replay_logit=0.5)
    with patch("app.liveness._get_session", return_value=session):
        result = check_liveness(image, bbox)
    assert result.verdict == "LIVE"
    assert result.score >= LIVE_THRESHOLD


def test_check_liveness_returns_spoof_below_threshold():
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    bbox = (10, 90, 90, 10)
    # Logits favoring the print-attack class.
    session = _mock_session(live_logit=0.5, spoof_logit=5.0, replay_logit=0.5)
    with patch("app.liveness._get_session", return_value=session):
        result = check_liveness(image, bbox)
    assert result.verdict == "SPOOF"
    assert result.score < LIVE_THRESHOLD


def test_check_liveness_returns_unknown_for_empty_crop():
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    bbox = (10, 10, 10, 10)  # zero-area bbox
    result = check_liveness(image, bbox)
    assert result.verdict == "UNKNOWN"
    assert result.reason == "empty_crop"
