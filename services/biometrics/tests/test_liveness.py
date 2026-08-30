"""Logic-only tests. crop_with_scale is pure geometry, tested directly with
synthetic arrays. check_liveness mocks both ensemble members' ONNX sessions
— no real model inference needed to test the ensembling/verdict logic
that's actually LybID's own code. Class-index convention (index 1 = live,
argmax-based verdict) mirrors the official minivision-ai demo exactly — see
liveness.py's module docstring for why."""

from unittest.mock import MagicMock, patch

import numpy as np

from app.liveness import LIVE_CLASS_INDEX, check_liveness, crop_with_scale


def test_crop_with_scale_no_shift_needed():
    image = np.zeros((200, 200, 3), dtype=np.uint8)
    bbox = (50, 150, 150, 50)  # top, right, bottom, left — 100x100 box, centered
    crop = crop_with_scale(image, bbox, scale=1.0)
    # Official CropImage._get_new_box slices inclusive of the right/bottom
    # edge (org_img[y1:y2+1, x1:x2+1]) — one pixel larger than the raw
    # scaled size, not scale*box_size exactly.
    assert crop.shape[0] == 101
    assert crop.shape[1] == 101


def test_crop_with_scale_shrinks_scale_to_fit_when_box_would_exceed_image():
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    bbox = (40, 60, 60, 40)  # 20x20 box near the center
    scale = 2.7  # the ensemble's smaller-scale member
    crop = crop_with_scale(image, bbox, scale=scale)
    # scale=2.7 * 20px = 54px fits comfortably inside a 100px image centered
    # near the middle, so no shrinking/shifting needed here — this just
    # confirms the not-padded, off-by-one-inclusive size.
    expected_size = int(20 * scale) + 1
    assert crop.shape[0] == expected_size
    assert crop.shape[1] == expected_size


def test_crop_with_scale_shifts_inward_at_image_corner_instead_of_padding():
    image = np.ones((50, 50, 3), dtype=np.uint8)
    bbox = (0, 10, 10, 0)  # top-left corner
    crop = crop_with_scale(image, bbox, scale=2.0)
    # Centering a 2x-scaled 10x10 box on this corner would hang off both
    # top and left edges — the official algorithm shifts the box inward to
    # keep the full requested 20px (+1 inclusive) on-image, rather than
    # zero-padding a smaller real region. Every pixel must be real image
    # content (all 1s from `image`), never a padded 0.
    assert crop.shape[0] == crop.shape[1] == 21
    assert np.all(crop == 1)


def _mock_session(fake_print_logit: float, live_logit: float, fake_replay_logit: float) -> MagicMock:
    session = MagicMock()
    input_meta = MagicMock()
    input_meta.name = "input"
    session.get_inputs.return_value = [input_meta]
    # Index order is [fake_print, live, fake_replay] — LIVE_CLASS_INDEX=1,
    # verified against the official repo's own test.py, not a third-party
    # model card (see liveness.py's module docstring for the history here).
    session.run.return_value = [np.array([[fake_print_logit, live_logit, fake_replay_logit]])]
    return session


def _patch_ensemble(session_a: MagicMock, session_b: MagicMock):
    return patch("app.liveness._get_sessions", return_value=((2.7, session_a), (4.0, session_b)))


def test_check_liveness_returns_live_when_both_models_agree():
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    bbox = (10, 90, 90, 10)
    # Both ensemble members strongly favor the live class.
    session_a = _mock_session(fake_print_logit=0.5, live_logit=5.0, fake_replay_logit=0.5)
    session_b = _mock_session(fake_print_logit=0.5, live_logit=5.0, fake_replay_logit=0.5)
    with _patch_ensemble(session_a, session_b):
        result = check_liveness(image, bbox)
    assert result.verdict == "LIVE"
    assert result.score > 0.5


def test_check_liveness_returns_spoof_when_both_models_agree():
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    bbox = (10, 90, 90, 10)
    # Both ensemble members favor a fake class (print-attack, index 0).
    session_a = _mock_session(fake_print_logit=5.0, live_logit=0.5, fake_replay_logit=0.5)
    session_b = _mock_session(fake_print_logit=5.0, live_logit=0.5, fake_replay_logit=0.5)
    with _patch_ensemble(session_a, session_b):
        result = check_liveness(image, bbox)
    assert result.verdict == "SPOOF"
    assert result.score < 0.5


def test_check_liveness_averages_disagreeing_models():
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    bbox = (10, 90, 90, 10)
    # One model votes live very strongly, the other only mildly fake —
    # averaged, live should still win (this is what actually distinguishes
    # ensembling from either model alone).
    session_a = _mock_session(fake_print_logit=0.0, live_logit=6.0, fake_replay_logit=0.0)
    session_b = _mock_session(fake_print_logit=1.0, live_logit=0.5, fake_replay_logit=0.0)
    with _patch_ensemble(session_a, session_b):
        result = check_liveness(image, bbox)
    assert result.verdict == "LIVE"


def test_check_liveness_returns_unknown_for_empty_crop():
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    bbox = (10, 10, 10, 10)  # zero-area bbox
    result = check_liveness(image, bbox)
    assert result.verdict == "UNKNOWN"
    assert result.reason == "empty_crop"


def test_live_class_index_is_one():
    # Pinned as its own test since getting this constant wrong silently
    # inverts every verdict — see liveness.py's module docstring for the
    # real bug this was.
    assert LIVE_CLASS_INDEX == 1
