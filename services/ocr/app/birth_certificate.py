"""Libyan birth certificate field extraction.

No MRZ-equivalent standard exists for birth certificates, and Libyan civil
registry forms vary across municipalities/years (per the user's own
caution). Rather than fixed pixel-coordinate ROI boxes tied to one template
(fragile against that drift), this anchors on known Arabic label keywords
found via Tesseract's word-level bounding boxes, then reads the value box
positioned to the label's left — Libyan civil registry forms are RTL with
the label in a (usually smaller) box to the right of its value box.

Tested against a real document for the first time on 2026-09-01 (Phase 9
verification round) — the earlier "untuned, unverified" caveat was
correct to worry: it found two real bugs, both fixed here, not just
image-quality noise:

1. `_LABEL_KEYWORDS` had multi-word phrases (e.g. "اسم الأب") as the ONLY
   keyword for father_name/mother_name/family_registry_number, but the
   old matching logic checked a keyword against a single Tesseract word
   token (`image_to_data` never returns a token containing a space) — so
   those three fields could never match on ANY document, synthetic or
   real. The synthetic fixture test never caught this because it didn't
   assert on those specific fields' values, only that extraction ran.
2. Label matching took the *first* word (in Tesseract's own arbitrary
   token order) matching *any* keyword, not the most specific one —
   `full_name`'s bare "الاسم" fallback matched a substring inside the
   informant-name field's instructional text ("...يذكر الاسم
   والعنوان...") on a real form, instead of the actual "الاسم ثلاثي"
   label at the top, and returned that field's garbage as the person's
   name.

Fixed by grouping words into lines (via Tesseract's own line/par/block
segmentation, already present in `image_to_data`'s output) and matching
keywords against contiguous word windows within each line, trying each
field's keywords in priority order (most specific first) — so multi-word
phrases can match at all, and a specific phrase always wins over a
generic fallback substring found elsewhere on the page. Only the specific
words making up the matched phrase are excluded from candidate values —
not the whole line — because a label and its value can share one
Tesseract line (they do on this project's own synthetic test fixture);
excluding the whole line the first time this was fixed silently ate the
value words too and regressed the existing test.

Still explicitly MVP-quality: real OCR *character* accuracy on a phone
photo of an official stamped/boxed form remains poor even after this fix
(the raw Tesseract text itself is often badly garbled) — this fix makes
correct extraction possible when Tesseract reads the label text right, it
doesn't make Tesseract read low-quality scans better. That's a separate,
harder image-quality problem (see preprocessing.py), not a matching-logic
one.
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
    line_key: Tuple[int, int, int]


# Each canonical field maps to Arabic keyword(s) that appear in its label
# box, most specific first — priority order matters now (see module
# docstring point 2): a specific multi-word phrase is always tried, across
# every line, before any generic single-word fallback.
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
# 700, not the original 400 — a third real bug, only exposed once the
# first two were fixed. The original 400 was implicitly calibrated
# against a masking bug: with a single anchor word (not the full label
# phrase) excluded, a multi-word label's *other* word (e.g. "ثلاثي" in
# "الاسم ثلاثي") was itself eligible as a "value" candidate and sat only
# ~5px from the anchor — so the true, much larger label-box-to-value-box
# gap on this form was never actually measured. Once both bugs above were
# fixed and the real gap was measured directly on the synthetic fixture
# (534-596px across every field), 400 rejected every genuine value.
_MAX_HORIZONTAL_GAP_PX = 700


def extract_birth_certificate_fields(
    image: np.ndarray, lang: str = "ara"
) -> Tuple[str, List[ExtractedField], float]:
    raw_text = pytesseract.image_to_string(image, lang=lang)
    data = pytesseract.image_to_data(image, lang=lang, output_type=pytesseract.Output.DICT)

    words = _extract_words(data)
    lines = _group_lines(words)

    fields: List[ExtractedField] = []
    for field_name, keywords in _LABEL_KEYWORDS.items():
        label_words = _find_label_words(lines, keywords)
        if label_words is None:
            continue
        label_anchor = max(label_words, key=lambda w: w["left"])
        value_words = _find_value_to_left(words, label_words, label_anchor)
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
                line_key=(data["block_num"][i], data["par_num"][i], data["line_num"][i]),
            )
        )
    return words


def _group_lines(words: List[_Word]) -> List[List[_Word]]:
    """Groups words by Tesseract's own line segmentation, not re-derived
    geometry — layout analysis (which words share a line) and character
    recognition (what a word's text actually is) are different Tesseract
    capabilities; the latter can be poor on a noisy real scan while the
    former still holds up reasonably. Sorted left-to-right by pixel
    position within each line (not visual RTL reading order — see
    `_find_label_line`, which checks both orderings)."""
    lines: Dict[Tuple[int, int, int], List[_Word]] = {}
    for w in words:
        lines.setdefault(w["line_key"], []).append(w)
    return [sorted(ws, key=lambda w: w["left"]) for ws in lines.values()]


def _find_label_words(lines: List[List[_Word]], keywords: List[str]) -> Optional[List[_Word]]:
    """Tries each keyword in priority order (most specific first) against
    every line, checked as a contiguous word window in both left-to-right
    pixel order and reversed — Tesseract's per-word token order for an
    Arabic (RTL) line isn't reliably one or the other. Returns only the
    specific words making up the matched phrase (a window the size of the
    keyword's own word count), not the whole line — see the module
    docstring for why returning the whole line was tried first and
    regressed the existing test."""
    for keyword in keywords:
        parts = keyword.split()
        for line in lines:
            for ordered in (line, list(reversed(line))):
                for start in range(len(ordered) - len(parts) + 1):
                    window = ordered[start : start + len(parts)]
                    joined = " ".join(w["text"] for w in window)
                    if keyword in joined:
                        return window
    return None


def _find_value_to_left(
    words: List[_Word], label_words: List[_Word], label_anchor: _Word
) -> List[_Word]:
    """Words vertically aligned with the label, positioned to its left (the
    value box, in this RTL form layout). Excludes exactly the words making
    up the matched label phrase (which may share a Tesseract line with the
    value, as on this project's synthetic fixture) — not the whole line,
    which would also exclude genuine value words on the same line."""
    label_mid_y = label_anchor["top"] + label_anchor["height"] / 2
    label_word_ids = {(w["left"], w["top"], w["text"]) for w in label_words}
    candidates = [
        w
        for w in words
        if (w["left"], w["top"], w["text"]) not in label_word_ids
        and abs((w["top"] + w["height"] / 2) - label_mid_y) <= _MAX_VERTICAL_GAP_PX
        and w["left"] < label_anchor["left"]
        and (label_anchor["left"] - (w["left"] + w["width"])) <= _MAX_HORIZONTAL_GAP_PX
    ]
    candidates.sort(key=lambda w: w["left"])
    return candidates
