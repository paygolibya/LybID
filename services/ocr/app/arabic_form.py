"""Generic keyword-anchored Arabic form field extraction — the same
algorithm as app/birth_certificate.py, factored out here so the 3 Phase 3
(KYB) document types (commercial registration, chamber of commerce, tax ID)
can share it instead of each carrying a near-duplicate copy.

birth_certificate.py itself is left untouched rather than refactored to
call this — don't touch working, tested Phase 1 code for a refactor-only
reason. This is an acknowledged small duplication (birth_certificate.py's
own inline copy vs. this shared one) traded for zero risk to already-
verified Phase 1 code. See birth_certificate.py's own docstring for the
rationale behind the algorithm itself (label-anchored rather than fixed
pixel-coordinate ROI boxes, since no MRZ-equivalent standard exists for any
of these Libyan government/business forms and their layouts vary).

Explicitly MVP-quality and UNTUNED against a real sample — same caveat as
birth_certificate.py. Each caller module's own _LABEL_KEYWORDS are
best-guess Arabic terminology, not verified against a real document.
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


_MAX_VERTICAL_GAP_PX = 15
_MAX_HORIZONTAL_GAP_PX = 400


def extract_arabic_form_fields(
    image: np.ndarray, label_keywords: Dict[str, List[str]], lang: str = "ara"
) -> Tuple[str, List[ExtractedField], float]:
    """`label_keywords` maps a canonical field name to the Arabic keyword(s)
    that appear in its label box — matching any one keyword is enough
    (labels are short; over-matching a false substring is the bigger risk
    than under-matching, since a multi-keyword AND requirement would be
    brittle against OCR misreads of the label itself)."""
    raw_text = pytesseract.image_to_string(image, lang=lang)
    data = pytesseract.image_to_data(image, lang=lang, output_type=pytesseract.Output.DICT)

    words = _extract_words(data)

    fields: List[ExtractedField] = []
    for field_name, keywords in label_keywords.items():
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
