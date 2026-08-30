"""Libyan birth certificate field extraction.

No MRZ-equivalent standard exists for birth certificates, and Libyan civil
registry forms vary across municipalities/years (per the user's own
caution). Rather than fixed pixel-coordinate ROI boxes tied to one template
(fragile against that drift), this anchors on known Arabic label keywords
found via Tesseract's word-level bounding boxes, then reads the value box
positioned to the label's left — Libyan civil registry forms are RTL with
the label in a (usually smaller) box to the right of its value box.

Explicitly MVP-quality and UNTUNED against a real sample — the one real
document seen in chat was never saved (per the user's request), so this
heuristic's real-world accuracy is unverified. See the Phase 1 plan.
"""

from typing import Dict, List, Optional, Tuple, TypedDict

import numpy as np
import pytesseract

from .schemas import ExtractedField


class _Word(TypedDict):
    text: str
    left: int
    top: int
    width: int
    height: int
    conf: float


# Each canonical field maps to Arabic keyword(s) that appear in its label
# box. Matching any one keyword is enough (labels are short; over-matching
# a false substring is the bigger risk than under-matching here, since a
# multi-keyword AND requirement would be brittle against OCR misreads of
# the label itself).
_LABEL_KEYWORDS: Dict[str, List[str]] = {
    "full_name": ["الاسم ثلاثي", "الاسم"],
    "date_of_birth_day": ["اليوم"],
    "date_of_birth_month": ["الشهر"],
    "date_of_birth_year": ["السنة"],
    "place_of_birth": ["مكان الولادة", "المحلة"],
    "gender": ["الجنس"],
    "father_name": ["اسم الأب"],
    "mother_name": ["اسم الأم"],
    "family_registry_number": ["رقم قيد العائلة", "قيد العائلة"],
}

_MAX_VERTICAL_GAP_PX = 15
_MAX_HORIZONTAL_GAP_PX = 400


def extract_birth_certificate_fields(
    image: np.ndarray, lang: str = "ara"
) -> Tuple[str, List[ExtractedField], float]:
    raw_text = pytesseract.image_to_string(image, lang=lang)
    data = pytesseract.image_to_data(image, lang=lang, output_type=pytesseract.Output.DICT)

    words = _extract_words(data)

    fields: List[ExtractedField] = []
    for field_name, keywords in _LABEL_KEYWORDS.items():
        label = _find_label(words, keywords)
        if label is None:
            continue
        value_words = _find_value_to_left(words, label)
        if not value_words:
            continue
        value_text = " ".join(w["text"] for w in value_words)
        avg_confidence = sum(w["conf"] for w in value_words) / len(value_words)
        fields.append(ExtractedField(name=field_name, value=value_text, confidence=avg_confidence))

    overall_confidence = sum(f.confidence for f in fields) / len(fields) if fields else 0.0
    return raw_text, fields, overall_confidence


def _extract_words(data: dict) -> List[_Word]:
    words: List[_Word] = []
    for i in range(len(data["text"])):
        text = data["text"][i].strip()
        if not text:
            continue
        conf = float(data["conf"][i])
        if conf < 0:  # Tesseract uses -1 for non-text regions
            continue
        words.append(
            _Word(
                text=text,
                left=data["left"][i],
                top=data["top"][i],
                width=data["width"][i],
                height=data["height"][i],
                conf=conf / 100.0,
            )
        )
    return words


def _find_label(words: List[_Word], keywords: List[str]) -> Optional[_Word]:
    for w in words:
        if any(k in w["text"] for k in keywords):
            return w
    return None


def _find_value_to_left(words: List[_Word], label: _Word) -> List[_Word]:
    """Words vertically aligned with the label, positioned to its left (the
    value box, in this RTL form layout)."""
    label_mid_y = label["top"] + label["height"] / 2
    candidates = [
        w
        for w in words
        if w is not label
        and abs((w["top"] + w["height"] / 2) - label_mid_y) <= _MAX_VERTICAL_GAP_PX
        and w["left"] < label["left"]
        and (label["left"] - (w["left"] + w["width"])) <= _MAX_HORIZONTAL_GAP_PX
    ]
    candidates.sort(key=lambda w: w["left"])
    return candidates
