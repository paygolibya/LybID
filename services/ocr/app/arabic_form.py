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

Updated 2026-09-01 to carry over ONE of birth_certificate.py's two real-
document fixes: label matching now groups words into Tesseract's own
lines and tries each field's keywords in priority order (most specific
first) as a contiguous word window — birth_certificate.py's old version
of this exact code took the first word (Tesseract's own arbitrary token
order) matching *any* keyword, which on a real document let a generic
single-word fallback match an unrelated field elsewhere on the page
instead of the correct, more specific label. Every field here already had
a single-word fallback behind its specific phrase (unlike
father_name/mother_name/family_registry_number in birth_certificate.py,
which had ONLY a multi-word keyword and could never match at all before
that fix) — so this module didn't have that particular dead-field bug,
but it had this one, unchanged, until now.

Deliberately NOT carried over: birth_certificate.py's multi-variant
preprocessing ensemble (scale factors, a QR/barcode crop, PSM tuning) —
that was empirically tuned against ONE real birth certificate's specific
layout and image quality. Applying those same numbers here, to three
different document types nobody has ever tested against a real sample,
would be a guess dressed up as a fix, not a verified one. Still
explicitly MVP-quality and UNTUNED against a real sample — same caveat as
birth_certificate.py always had. Each caller module's own _LABEL_KEYWORDS
are best-guess Arabic terminology, not verified against a real document.
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


_MAX_VERTICAL_GAP_PX = 15
# Left at 400, NOT birth_certificate.py's corrected 700 — that number was
# measured directly against one real document's specific label-to-value
# box geometry (534-596px). No real sample of any of these three document
# types has ever been checked, so there's no evidence 700 (or any other
# number) is the right value here; changing it without evidence would be
# the same mistake as the reverted birth-certificate upscale attempt.
_MAX_HORIZONTAL_GAP_PX = 400


def extract_arabic_form_fields(
    image: np.ndarray, label_keywords: Dict[str, List[str]], lang: str = "ara"
) -> Tuple[str, List[ExtractedField], float]:
    """`label_keywords` maps a canonical field name to the Arabic keyword(s)
    that appear in its label box, most specific first — priority order
    matters (see module docstring): a specific multi-word phrase is always
    tried, across every line, before any generic single-word fallback."""
    raw_text = pytesseract.image_to_string(image, lang=lang)
    data = pytesseract.image_to_data(image, lang=lang, output_type=pytesseract.Output.DICT)

    words = _extract_words(data)
    lines = _group_lines(words)

    fields: List[ExtractedField] = []
    for field_name, keywords in label_keywords.items():
        found = _find_label_words(lines, keywords)
        if found is None:
            continue
        label_words, _keyword_rank = found
        # min, not max — the label word CLOSEST to the value box (smallest
        # `left`, i.e. the phrase's leftmost/innermost word in this RTL
        # layout), not the phrase's outermost/rightmost word. A real bug
        # found testing this exact change against the synthetic fixtures:
        # anchoring on the rightmost word of a multi-word phrase (e.g.
        # "اسم" in "اسم الشركة") measures the gap from the WRONG edge of
        # the label box, widening it past _MAX_HORIZONTAL_GAP_PX for every
        # multi-word match and silently finding zero fields — the old
        # single-word-only matching never hit this because it always
        # anchored on the one label word actually present, which happened
        # to already be the word closest to the value.
        label_anchor = min(label_words, key=lambda w: w["left"])
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
    """Groups words by Tesseract's own line segmentation — see
    birth_certificate.py's identical helper for the full rationale."""
    lines: Dict[Tuple[int, int, int], List[_Word]] = {}
    for w in words:
        lines.setdefault(w["line_key"], []).append(w)
    return [sorted(ws, key=lambda w: w["left"]) for ws in lines.values()]


def _find_label_words(
    lines: List[List[_Word]], keywords: List[str]
) -> Optional[Tuple[List[_Word], int]]:
    """Tries each keyword in priority order (most specific first) against
    every line, checked as a contiguous word window in both left-to-right
    pixel order and reversed — see birth_certificate.py's identical helper
    for the full rationale (Tesseract's per-word token order for an Arabic
    RTL line isn't reliably one or the other)."""
    for rank, keyword in enumerate(keywords):
        parts = keyword.split()
        for line in lines:
            for ordered in (line, list(reversed(line))):
                for start in range(len(ordered) - len(parts) + 1):
                    window = ordered[start : start + len(parts)]
                    joined = " ".join(w["text"] for w in window)
                    if keyword in joined:
                        return window, rank
    return None


def _find_value_to_left(
    words: List[_Word], label_words: List[_Word], label_anchor: _Word
) -> List[_Word]:
    """Words vertically aligned with the label, positioned to its left (the
    value box, in this RTL form layout). Excludes exactly the words making
    up the matched label phrase, not the whole line — see
    birth_certificate.py's identical helper for why."""
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
