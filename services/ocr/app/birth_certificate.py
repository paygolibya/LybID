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

Round 2 — the actual raw-character-recognition problem on a phone photo,
confirmed to be real by fixing round 1 first (label matching alone
recovered family_registry_number correctly, proving the logic was the
bug there; full_name and most other fields still failed with CORRECT
matching logic because Tesseract's raw text for those regions was simply
unreadable garbage — a genuinely different problem, not a matching bug).
Fixed by ensembling two phone-photo-tuned preprocessing variants
("wide": 2.0x upscale, standard PSM; "cropped": blank the QR/barcode
corners, 1.6x upscale, PSM 4) and merging per field.

Round 3 (2026-09-25) — a second real sample turned out to be a different
INPUT TYPE entirely: a clean, high-resolution (2481x3509, 300 DPI)
rendered PDF scan with yellow highlighter marks over the fields that
matter, not a phone photo. Against round 2's phone-photo-tuned ensemble
it scored WORSE than the phone photo had (0 fields, completely garbled
raw text) despite being objectively higher quality — no camera blur, no
lighting variation, no perspective distortion. Investigated the same way
as round 2 (scoring real tokens across variants, not eyeballing):

1. The yellow highlighter measurably hurts recognition on its own —
   confirmed by neutralizing it (detecting yellow via HSV and painting
   those regions white before grayscale conversion) as an isolated
   change.
2. The bigger effect, found by testing WITHOUT it: denoise + CLAHE +
   adaptive-threshold — this module's whole preprocessing philosophy,
   justified in preprocessing.py's own docstring for "raw phone-camera
   photos" — actively hurts a document that never needed it. A clean
   PDF render has none of the noise that pipeline exists to fix; forcing
   it through anyway measurably cost accuracy (best variant with the
   full pipeline: 2/21 known real tokens; same document, no threshold at
   all, page-segmentation mode 11 for sparse/scattered form text: 9/21).

So the ensemble gained a third family of variants tuned for this input
type — yellow-neutralized, little-to-no binarization, PSM 11 — on top of
(not replacing) round 2's phone-photo variants, since both are real
inputs this system has to handle (file-validation already accepts PDF
for birth certificates) and neither family suits the other's input well.
Yellow-neutralization is applied unconditionally before every variant —
verified not to hurt the phone-photo case (that document had no
highlighter) and to measurably help the PDF-scan case.

Still explicitly MVP-quality, and still not a claim of production
accuracy — three preprocessing families covering two real documents is
real, verified progress on a real, still-open problem, not a solved one.
See the root README's Phase 1/Phase 9 sections.
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
#
# registry_office/national_number/nationality/informant_role added
# 2026-09-25 against a second real sample, which highlighted these as the
# fields that actually matter for identity verification (as opposed to
# the first sample's father_name/mother_name/family_registry_number,
# which are real fields on the form but weren't the ones flagged as
# load-bearing). Kept the originals rather than replacing them — they're
# still real, present fields, just not this round's focus. "sex", not
# "gender" — matching the field name given for the DB/consistency-check
# layer that consumes this; a plain rename, no schema migration needed
# since extracted fields are stored generically (name/value/confidence),
# not as typed columns.
_LABEL_KEYWORDS: Dict[str, List[str]] = {
    "registry_office": ["مكتب السجل المدني", "السجل المدني"],
    "national_number": ["الرقم الوطني"],
    "full_name": ["الاسم الثلاثي", "الاسم ثلاثي", "الاسم"],
    "date_of_birth_day": ["اليوم"],
    "date_of_birth_month": ["الشهر"],
    "date_of_birth_year": ["السنة"],
    "place_of_birth": ["مكان الولادة", "المحلة"],
    "sex": ["الجنس"],
    "nationality": ["جنسيته"],
    "father_name": ["اسم الأب"],
    "mother_name": ["اسم الأم"],
    "family_registry_number": ["رقم قيد العائلة", "قيد العائلة"],
    # Who REPORTED the birth (e.g. "موظف" = a civil registry employee),
    # not the birth-certificate holder — not useful for identity
    # matching, but a real document-authenticity signal: a properly
    # filled civil registry form has this populated by a real official
    # capacity. Kept as its own field rather than folded into anything
    # identity-related, exactly per its actual meaning on the form.
    "informant_role": ["صفته"],
}

# Labels for the signature/stamp box — not a text field (see
# detect_official_stamp below), kept separate from _LABEL_KEYWORDS since
# it's found the same way but consumed differently (presence, not text).
_STAMP_LABEL_KEYWORDS = ["توقيع الموظف المختص والختم", "والختم", "الختم"]

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
    module docstring)."""
    neutralized_bgr = _neutralize_highlighter(image)
    gray = cv2.cvtColor(neutralized_bgr, cv2.COLOR_BGR2GRAY)
    gray = deskew(gray)

    raw_texts: List[str] = []
    per_variant_fields: List[List[Tuple[ExtractedField, int]]] = []
    per_variant_words: List[List[_Word]] = []
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
        words = _extract_words(data, scale)
        per_variant_words.append(words)
        per_variant_fields.append(_extract_fields_from_words(words))

    fields = _merge_fields(per_variant_fields)

    stamp_field = _detect_official_stamp(gray, per_variant_words)
    if stamp_field is not None:
        fields.append(stamp_field)

    combined_raw_text = "\n---\n".join(raw_texts)
    overall_confidence = sum(f.confidence for f in fields) / len(fields) if fields else 0.0
    return combined_raw_text, fields, overall_confidence


def _neutralize_highlighter(bgr: np.ndarray) -> np.ndarray:
    """Paints bright-yellow highlighter marks white before anything else
    runs — see module docstring, round 3. Detected via HSV (yellow hue
    ~15-40 in OpenCV's 0-179 range, real highlighter is high-saturation
    and bright) rather than a fixed color match, so ordinary yellowed
    paper or a light cream background isn't caught by the same net —
    those are lower-saturation than an actual marker. Only paints the
    BRIGHT part of the highlighted region white (value channel > 150) so
    a dark pen stroke that happens to be highlighted isn't erased along
    with its background."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    yellow_mask = cv2.inRange(hsv, (15, 40, 120), (40, 255, 255))
    is_highlight_bg = (yellow_mask > 0) & (hsv[:, :, 2] > 150)
    out = bgr.copy()
    out[is_highlight_bg] = [255, 255, 255]
    return out


def _preprocess_variants(gray: np.ndarray) -> List[Tuple[np.ndarray, str, float]]:
    """Returns (preprocessed_image, tesseract_config, scale_factor) triples
    — see module docstring for what each variant/family is for. Three
    families now, covering two real, different input types:
      - "wide"/"cropped": round 2's phone-photo variants (2.0x upscale
        default PSM; QR/barcode corners blanked, 1.6x upscale, PSM 4).
      - "clean-scan": round 3's variant for a clean, already-high-
        resolution PDF render — little to no binarization (that pipeline
        measurably hurts this input type) and PSM 11 (sparse/scattered
        text), which suited this form's boxed layout far better than
        automatic segmentation once the image itself wasn't degraded by
        an unneeded aggressive threshold.
    All scale factors, crop fractions, and the choice of PSM per variant
    are empirical, each tuned against ONE real document of its type —
    reasonable defaults, not calibrated constants; the ensemble's own
    redundancy across three families is the safety net for whichever
    document type actually shows up."""
    h, w = gray.shape

    cropped = gray.copy()
    cropped[0 : int(h * 0.12), int(w * 0.78) :] = 255  # blank the QR corner
    cropped[int(h * 0.92) :, 0 : int(w * 0.35)] = 255  # blank the barcode strip

    return [
        (_denoise_contrast_threshold(_scale(gray, 2.0)), "", 2.0),
        (_denoise_contrast_threshold(_scale(cropped, 1.6)), "--psm 4", 1.6),
        (gray, "--psm 11", 1.0),
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
    other document type also calls). Deliberately NOT applied to the
    "clean-scan" variant — see module docstring, round 3."""
    denoised = cv2.fastNlMeansDenoising(gray, h=10)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    contrasted = clahe.apply(denoised)
    return cv2.adaptiveThreshold(
        contrasted, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11
    )


def _extract_fields_from_words(words: List[_Word]) -> List[Tuple[ExtractedField, int]]:
    """Each field is paired with the priority-rank of the keyword that
    matched it (0 = the most specific keyword for that field, per
    _LABEL_KEYWORDS' own order) — kept internal to this module, not part
    of the public ExtractedField schema, purely to let _merge_fields
    prefer a specific match over a generic-fallback one (see its own
    docstring for why that has to outrank raw OCR confidence)."""
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
        # label box, artificially widening it.
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
    non-overlapping subset of real fields, so this stays "union,
    tie-broken," not "pick the best variant overall.\""""
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


def _detect_official_stamp(
    gray: np.ndarray, per_variant_words: List[List[_Word]]
) -> Optional[ExtractedField]:
    """The signature/stamp box (توقيع الموظف المختص والختم) is different in
    kind from every other field here — it's not text to OCR, it's a
    presence check: is there ink in that region at all? Anchored on the
    detected label's own position (same approach as every text field, not
    a fixed template coordinate), checking the box to the label's left —
    the same value-box convention as text fields — for what fraction of
    pixels are dark ink rather than blank paper.

    Returns None if no variant ever found the label at all (can't check a
    region we don't know the location of) — the caller treats that as "no
    stamp field reported," not "stamp absent," which is the honest
    distinction: we don't know, we didn't fail to find one.

    The ink-fraction threshold (2%) is a reasonable starting guess against
    ONE real document known to have a real stamp in this box — not a
    calibrated classifier. Confidence is deliberately capped at 0.6,
    lower than a real text-match's typical confidence, to reflect that
    this is a heuristic, not OCR reading actual characters."""
    label_words = None
    for words in per_variant_words:
        lines = _group_lines(words)
        found = _find_label_words(lines, _STAMP_LABEL_KEYWORDS)
        if found is not None:
            label_words, _rank = found
            break
    if label_words is None:
        return None

    label_anchor = min(label_words, key=lambda w: w["left"])
    label_mid_y = label_anchor["top"] + label_anchor["height"] / 2
    box_top = max(0, int(label_mid_y - 60))
    box_bottom = min(gray.shape[0], int(label_mid_y + 60))
    box_right = label_anchor["left"]
    box_left = max(0, box_right - _MAX_HORIZONTAL_GAP_PX)
    if box_bottom <= box_top or box_right <= box_left:
        return None

    region = gray[box_top:box_bottom, box_left:box_right]
    if region.size == 0:
        return None
    ink_fraction = float((region < 140).mean())
    present = ink_fraction > 0.02
    return ExtractedField(
        name="official_stamp_present",
        value="true" if present else "false",
        confidence=0.6,
    )


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
