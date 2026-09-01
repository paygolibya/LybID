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
correct to worry. Two rounds of real fixes came out of it:

Round 1 — label-matching logic bugs (not image-quality):
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
3. `_MAX_HORIZONTAL_GAP_PX` (400) was implicitly miscalibrated against
   bug #2's masking effect and rejected every genuine value once #1/#2
   were fixed and the real gap (534-596px) was measurable. Now 700.

Round 2 — the actual raw-character-recognition problem, confirmed to be
real by fixing round 1 first (label matching alone recovered
family_registry_number correctly, proving the logic was the bug there;
full_name and most other fields still failed with CORRECT matching logic
because Tesseract's raw text for those regions was simply unreadable
garbage — a genuinely different problem, not a matching bug).

Investigated by scoring several preprocessing variants against every real
token actually printed on a real test document (not just one target
field, which is how the first upscale attempt silently traded one
correct field for another). Finding: no single global preprocessing
choice (a scale factor, a page-segmentation mode, threshold vs. none)
was a clean win — each variant recovered a different, largely
non-overlapping subset of the real fields. The best single variant found
6 of 12 known real tokens; the two strongest variants together covered
10 of 12. That's not one bug with one fix — real photographed official
forms (small print, a boxed grid, uneven shading, a stamp/QR/barcode
Tesseract's layout analysis doesn't need) apparently need more than one
"read" to reliably get most fields right.

So `extract_birth_certificate_fields` now runs a small ENSEMBLE of two
preprocessing variants and merges per field (keeping whichever variant's
result has higher confidence for each field independently), instead of
committing to one preprocessing recipe:
  - variant "wide": deskew, 2.0x upscale, standard Tesseract PSM.
  - variant "cropped": deskew, blank out the QR-code and barcode corners
    (pure visual noise for OCR, confirmed to confuse layout analysis on
    the real test document), 1.6x upscale, PSM 4 (assumes one column of
    variable-size text — suits this form's boxed-row layout better than
    the default "fully automatic" segmentation).
Both scale factors and the crop fractions are empirical, tuned against
ONE real document — they are a reasonable default, not a calibrated
constant; the "cropped" variant's fixed corner fractions are a real,
known limitation (a differently-framed real submission could have its
QR/barcode in a different place, or none at all) — but the ensemble's
own redundancy is the safety net: variant "wide" never crops anything,
so any field variant "cropped" doesn't help still gets a fair try.

Still explicitly MVP-quality, and still not a claim of production
accuracy — an ensemble of two heuristic variants recovering most, not
all, of one real document's fields is real, verified progress, not a
solved problem. See the root README's Phase 1/Phase 9 sections.
"""

from typing import Dict, List, Optional, Tuple, TypedDict

import cv2
import numpy as np
import pytesseract

from .preprocessing import deskew
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
# box, most specific first — priority order matters: a specific multi-word
# phrase is always tried, across every line, before any generic
# single-word fallback (see module docstring, round 1, bug 2).
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
# 700, not a smaller number — see module docstring round 1, bug 3: the
# real label-box-to-value-box gap on this form measured 534-596px once
# matching itself was correct.
_MAX_HORIZONTAL_GAP_PX = 700


def extract_birth_certificate_fields(
    image: np.ndarray, lang: str = "ara"
) -> Tuple[str, List[ExtractedField], float]:
    """`image` is the RAW loaded (BGR) image, NOT pre-thresholded — unlike
    every other extractor in this service, this one owns its own
    preprocessing so it can run more than one variant internally (see
    module docstring, round 2)."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = deskew(gray)

    raw_texts: List[str] = []
    per_variant_fields: List[List[ExtractedField]] = []
    for variant_image, config, scale in _preprocess_variants(gray):
        raw_text = pytesseract.image_to_string(variant_image, lang=lang, config=config)
        data = pytesseract.image_to_data(
            variant_image, lang=lang, config=config, output_type=pytesseract.Output.DICT
        )
        raw_texts.append(raw_text)
        # Normalized back to the ORIGINAL image's pixel scale, not left at
        # whatever scale this variant's Tesseract call ran at — a real bug
        # found running this exact ensemble against the synthetic fixture:
        # _MAX_VERTICAL_GAP_PX/_MAX_HORIZONTAL_GAP_PX were calibrated at
        # native resolution, so at a 2x-upscaled variant every real gap
        # measures 2x more pixels and silently fails every threshold —
        # zero fields matched despite Tesseract reading the text perfectly.
        # Normalizing here keeps one set of thresholds valid across every
        # variant regardless of its own scale factor.
        per_variant_fields.append(_extract_fields_from_data(data, scale))

    fields = _merge_fields(per_variant_fields)
    combined_raw_text = "\n---\n".join(raw_texts)
    overall_confidence = sum(f.confidence for f in fields) / len(fields) if fields else 0.0
    return combined_raw_text, fields, overall_confidence


def _preprocess_variants(gray: np.ndarray) -> List[Tuple[np.ndarray, str, float]]:
    """Returns (preprocessed_image, tesseract_config, scale_factor) triples
    — see module docstring, round 2, for what each variant is for and why
    neither one alone was enough. `scale_factor` is how much larger than
    `gray` the returned image is, so the caller can normalize word
    coordinates back to a consistent scale before comparing gaps."""
    h, w = gray.shape

    cropped = gray.copy()
    cropped[0 : int(h * 0.12), int(w * 0.78) :] = 255  # blank the QR corner
    cropped[int(h * 0.92) :, 0 : int(w * 0.35)] = 255  # blank the barcode strip

    return [
        (_denoise_contrast_threshold(_scale(gray, 2.0)), "", 2.0),
        (_denoise_contrast_threshold(_scale(cropped, 1.6)), "--psm 4", 1.6),
    ]


def _scale(gray: np.ndarray, factor: float) -> np.ndarray:
    return cv2.resize(gray, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)


def _denoise_contrast_threshold(gray: np.ndarray) -> np.ndarray:
    """Same denoise/contrast/threshold steps as preprocessing.py's shared
    `preprocess_for_ocr` (kept as a separate copy rather than a shared
    helper both modules import — this module needs to run it multiple
    times per document on differently-scaled/cropped inputs, which isn't
    a shape `preprocess_for_ocr`'s single-image contract was built for;
    duplicating ~6 lines was less risky than reshaping a function every
    other document type also calls)."""
    denoised = cv2.fastNlMeansDenoising(gray, h=10)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    contrasted = clahe.apply(denoised)
    return cv2.adaptiveThreshold(
        contrasted, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11
    )


def _extract_fields_from_data(
    data: dict, scale: float
) -> List[Tuple[ExtractedField, int]]:
    """Each field is paired with the priority-rank of the keyword that
    matched it (0 = the most specific keyword for that field, per
    _LABEL_KEYWORDS' own order) — kept internal to this module, not part
    of the public ExtractedField schema, purely to let _merge_fields
    prefer a specific match over a generic-fallback one (see its own
    docstring for why that has to outrank raw OCR confidence)."""
    words = _extract_words(data, scale)
    lines = _group_lines(words)

    fields: List[Tuple[ExtractedField, int]] = []
    for field_name, keywords in _LABEL_KEYWORDS.items():
        found = _find_label_words(lines, keywords)
        if found is None:
            continue
        label_words, keyword_rank = found
        # min, not max — the label word CLOSEST to the value box, not the
        # phrase's outermost word. Real bug, found fixing the same code
        # path in arabic_form.py: anchoring on the rightmost word of a
        # multi-word phrase measures the gap from the wrong edge of the
        # label box, artificially widening it. _MAX_HORIZONTAL_GAP_PX
        # being 700 here (vs. arabic_form.py's untouched 400) was partly
        # this same bug's effect, not purely genuine gap measurement —
        # re-verified against the real document below that min() is still
        # correct (or better) here, not just carried over blindly.
        label_anchor = min(label_words, key=lambda w: w["left"])
        value_words = _find_value_to_left(words, label_words, label_anchor)
        if not value_words:
            continue
        value_text = " ".join(w["text"] for w in value_words)
        avg_confidence = sum(w["conf"] for w in value_words) / len(value_words)
        fields.append(
            (ExtractedField(name=field_name, value=value_text, confidence=avg_confidence), keyword_rank)
        )
    return fields


def _merge_fields(per_variant_fields: List[List[Tuple[ExtractedField, int]]]) -> List[ExtractedField]:
    """One result per field name. Keyword specificity rank wins first
    (lower rank = more specific keyword matched, see _find_label_words),
    raw OCR confidence only breaks ties within the same rank — NOT the
    other way around. A real bug found running this exact ensemble: a
    field matched only via a generic single-word fallback keyword can
    still get a high Tesseract confidence score if that (wrong) region of
    the page happened to be read cleanly — confidence measures "how sure
    Tesseract is about the characters," not "how likely this is the
    right field," and a clean read of the wrong region beat a noisier
    read of the right one every time until specificity was made to
    matter more. Each variant still recovers a different, largely
    non-overlapping subset of real fields (see module docstring, round
    2), so this stays "union, tie-broken," not "pick the best variant
    overall.\""""
    best_by_name: Dict[str, Tuple[ExtractedField, int]] = {}
    for fields in per_variant_fields:
        for field, rank in fields:
            existing = best_by_name.get(field.name)
            if existing is None:
                best_by_name[field.name] = (field, rank)
                continue
            existing_field, existing_rank = existing
            if rank < existing_rank or (rank == existing_rank and field.confidence > existing_field.confidence):
                best_by_name[field.name] = (field, rank)
    # _LABEL_KEYWORDS' own order, not dict-insertion order, for a stable,
    # predictable field order in the response regardless of which variant
    # found which field first.
    return [best_by_name[name][0] for name in _LABEL_KEYWORDS if name in best_by_name]


def _extract_words(data: dict, scale: float) -> List[_Word]:
    """`scale` divides every pixel coordinate/dimension back to the
    ORIGINAL image's scale — see extract_birth_certificate_fields' own
    comment for why this matters now that different variants run
    Tesseract at different scale factors."""
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
                left=round(data["left"][i] / scale),
                top=round(data["top"][i] / scale),
                width=round(data["width"][i] / scale),
                height=round(data["height"][i] / scale),
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
    `_find_label_words`, which checks both orderings)."""
    lines: Dict[Tuple[int, int, int], List[_Word]] = {}
    for w in words:
        lines.setdefault(w["line_key"], []).append(w)
    return [sorted(ws, key=lambda w: w["left"]) for ws in lines.values()]


def _find_label_words(
    lines: List[List[_Word]], keywords: List[str]
) -> Optional[Tuple[List[_Word], int]]:
    """Tries each keyword in priority order (most specific first) against
    every line, checked as a contiguous word window in both left-to-right
    pixel order and reversed — Tesseract's per-word token order for an
    Arabic (RTL) line isn't reliably one or the other. Returns the
    specific words making up the matched phrase (a window the size of the
    keyword's own word count, not the whole line — a whole-line exclusion
    regressed the synthetic fixture test in round 1, since the label and
    value can share one Tesseract line) together with which keyword's
    priority rank matched, for _merge_fields to weigh specificity over
    raw confidence (see its own docstring)."""
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
