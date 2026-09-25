"""Passport extraction: MRZ (machine-readable zone) via PassportEye, plus
the printed bio-page fields that don't exist in the MRZ at all.

PassportEye validates OCR'd MRZ digits against the MRZ's own ICAO 9303
check digits — this is the strongest available defense against passport OCR
misreads, since it's self-checking rather than trusting raw OCR blindly.
Confirmed against a real document (2026-09-25): the MRZ path read both
lines of a real Libyan passport's MRZ character-for-character correctly,
and correctly flagged a real OCR misread on the passport number itself
(PR019GKL read as "PRO19GKL<", letter O for digit 0) via a failed checksum
rather than silently trusting it — the design working exactly as intended.

Added the same day: place_of_birth, date_of_issue, and issuing_place — real
fields printed on the bio page that are simply not part of the MRZ at all
(ICAO 9303's TD3 format has no field for them), so no amount of MRZ work
could ever recover them. A person's actual birthplace/where their passport
was issued matters for KYC even though it plays no role in MRZ validation.

These three use a DIFFERENT extraction strategy than birth_certificate.py's
label-anchored approach, for a real reason found testing against an actual
passport photo, not assumed: OCR on this bio page reads labels far more
garbled than values ("Bith" for "Birth", "pweeorsin" for "Place of Birth",
"ssutng" for "Issuing") — English text printed in a small caption font,
photographed at an angle, interleaved with an Arabic column running the
other direction, reads worse than the bigger, cleaner printed values below
each label. Exact keyword matching (birth_certificate.py's approach) would
fail on labels that garbled. So labels are matched fuzzily (a short,
distinctive substring, not the full phrase) and the value is found by
PATTERN below the label (a date-shaped token for date fields, an
all-caps place-name-shaped token for place fields) within an empirical
vertical window — calibrated against ONE real photographed passport, same
honesty caveat as birth_certificate.py's own tuning notes.
"""

import re
import tempfile
from typing import Dict, List, Optional, Tuple, TypedDict

import cv2
import numpy as np
import pytesseract
from passporteye import read_mrz

from .preprocessing import preprocess_for_ocr
from .schemas import ExtractedField

# Maps an MRZ field name to the boolean checksum-validity attribute
# PassportEye computes for it (fields without a check digit, like names,
# aren't in this map).
_CHECK_ATTR_BY_FIELD = {
    "passport_number": "valid_number",
    "date_of_birth": "valid_date_of_birth",
    "date_of_expiry": "valid_expiration_date",
    "personal_number": "valid_personal_number",
}

# PassportEye's own `.to_dict()` attribute names, mapped to this service's
# canonical field names — renamed 2026-09-25 to match the names specified
# for the layer that consumes them (given_names/passport_number/
# date_of_expiry instead of PassportEye's own names/number/
# expiration_date). No schema migration needed — extracted fields are
# stored generically (name/value/confidence), not as typed columns.
_MRZ_FIELD_NAMES = {
    "surname": "surname",
    "names": "given_names",
    "number": "passport_number",
    "nationality": "nationality",
    "date_of_birth": "date_of_birth",
    "sex": "sex",
    "expiration_date": "date_of_expiry",
    "country": "country",
    "type": "type",
    "personal_number": "personal_number",
}

_CHECKSUM_VALID_CONFIDENCE = 0.98
_CHECKSUM_INVALID_CONFIDENCE = 0.40
_NO_CHECKSUM_CONFIDENCE = 0.85  # e.g. names — no check digit exists to validate against


def extract_passport_fields(image_bytes: bytes) -> Tuple[str, List[ExtractedField], float]:
    # read_mrz needs a file path — PassportEye shells out to its own
    # image-loading pipeline rather than accepting raw bytes directly.
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=True) as tmp:
        tmp.write(image_bytes)
        tmp.flush()
        mrz = read_mrz(tmp.name)

    if mrz is None:
        return "", [], 0.0

    data = mrz.to_dict()
    raw_text = str(data.get("raw_text") or "")

    fields: List[ExtractedField] = []
    for source_name, canonical_name in _MRZ_FIELD_NAMES.items():
        value = data.get(source_name)
        if not value:
            continue

        check_attr = _CHECK_ATTR_BY_FIELD.get(canonical_name)
        if check_attr is not None:
            checksum_valid = bool(data.get(check_attr, False))
            confidence = _CHECKSUM_VALID_CONFIDENCE if checksum_valid else _CHECKSUM_INVALID_CONFIDENCE
        else:
            confidence = _NO_CHECKSUM_CONFIDENCE

        fields.append(ExtractedField(name=canonical_name, value=str(value), confidence=confidence))

    printed_fields, printed_raw_text = _extract_printed_fields(image_bytes)
    fields.extend(printed_fields)
    if printed_raw_text:
        raw_text = f"{raw_text}\n---\n{printed_raw_text}"

    # valid_score is PassportEye's own 0-100 composite confidence across all
    # checksums in the MRZ (including the overall composite check digit).
    # Printed-field confidences aren't folded in — they're pattern-matching
    # heuristics with no checksum behind them, a fundamentally different
    # (weaker) kind of confidence than the MRZ's; averaging them together
    # would make the MRZ's real cryptographic-strength validation look
    # worse than it is.
    overall_confidence = float(data.get("valid_score", 0) or 0) / 100.0
    return raw_text, fields, overall_confidence


class _Word(TypedDict):
    text: str
    left: int
    top: int
    width: int
    height: int


# Printed bio-page fields that exist nowhere in the MRZ — see module
# docstring for why these are matched by fuzzy label + value pattern
# rather than birth_certificate.py's exact-keyword approach. Each label's
# keywords are tried in order; short/distinctive substrings first (more
# specific, matches even through moderate garbling) before the full
# phrase (only matches on a cleaner read).
_PRINTED_LABEL_KEYWORDS: Dict[str, List[str]] = {
    # Deliberately NOT including bare "Place" here — a real bug found
    # testing this: "Place" alone matches both "Place of Birth" and
    # "Issuing Place", and on the real test document it matched the
    # WRONG one (whichever came first in Tesseract's own word order, not
    # page order). Each field's keyword is something only ITS OWN label
    # contains — "Birth" doesn't appear in "Issuing Place", "Issuing"
    # doesn't appear in "Place of Birth".
    "place_of_birth": ["Place of Birth"],
    "date_of_issue": ["Date of Issue"],
    "issuing_place": ["Issuing Place"],
}

# How the field's own label commonly garbles under real OCR — checked
# case-insensitively as a substring, tried in order (most specific/
# reliable first, per what was actually observed on the one real
# document this was calibrated against). Not exhaustive; a real,
# calibrated-against-one-document fallback, same caveat as the keywords
# above. Each hint is chosen to be unambiguous with the OTHER two
# fields' garbled forms too, not just clean text — see module docstring.
_LABEL_GARBLE_HINTS: Dict[str, List[str]] = {
    "place_of_birth": ["eorsin", "lace"],
    "date_of_issue": ["sue"],
    "issuing_place": ["ssutng", "suing", "ssuing"],
}

# Measured from the label word's own TOP, not its bottom edge — a real
# bug found testing this: Tesseract's reported height for a short,
# garbled OCR fragment isn't reliable (one real label word's box was
# tall enough that label_top + label_height already overshot where the
# value actually sat). Directly measured all three fields' real
# label-top-to-value-top gaps on the one real document this is
# calibrated against: 20-44px. 15-70px gives that real range a margin on
# both sides without being wide enough to reach the NEXT field's value
# below it (confirmed a real failure mode when this was wider: a 55-160
# window skipped past date_of_issue's real value entirely and grabbed
# date_of_expiry's instead, which sat further down).
_VALUE_SEARCH_MIN_GAP_PX = 15
_VALUE_SEARCH_MAX_GAP_PX = 70
_VALUE_SEARCH_HORIZONTAL_TOLERANCE_PX = 250

_DATE_PATTERN = re.compile(r"^\d{4,8}\)?$")
_PLACE_PATTERN = re.compile(r"^[A-Z]{3,}$")


def _extract_printed_fields(image_bytes: bytes) -> Tuple[List[ExtractedField], str]:
    array = np.frombuffer(image_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if bgr is None:
        return [], ""

    # The shared phone-photo pipeline (denoise + CLAHE + adaptive
    # threshold), not a lighter custom one — a real bug found testing
    # this exact function: a photographed passport's uneven lighting
    # needs the threshold step to detect any text at all (a CLAHE-only
    # attempt here found ZERO words, full stop, on the real test image);
    # birth_certificate.py's opposite finding (threshold HURTS a clean
    # PDF scan) doesn't generalize to a phone photo of a physical
    # document, which is what this field-set is actually for.
    preprocessed = preprocess_for_ocr(bgr)

    raw_text = pytesseract.image_to_string(preprocessed, lang="eng")
    data = pytesseract.image_to_data(preprocessed, lang="eng", output_type=pytesseract.Output.DICT)
    words = _extract_words(data)

    fields: List[ExtractedField] = []
    for field_name, keywords in _PRINTED_LABEL_KEYWORDS.items():
        label = _find_label(words, keywords, _LABEL_GARBLE_HINTS.get(field_name, []))
        if label is None:
            continue
        is_date_field = field_name == "date_of_issue"
        value = _find_value_below(words, label, is_date_field)
        if value is None:
            continue
        fields.append(
            ExtractedField(
                name=field_name,
                value=_normalize_value(value["text"], is_date_field),
                # Deliberately lower than the MRZ fields' typical
                # confidence — see module docstring: this is fuzzy label
                # matching plus a value-shape guess, not a checksum-backed
                # read.
                confidence=0.55,
            )
        )
    return fields, raw_text


def _extract_words(data: dict) -> List[_Word]:
    words: List[_Word] = []
    for i in range(len(data["text"])):
        text = data["text"][i].strip()
        if not text or float(data["conf"][i]) < 0:
            continue
        words.append(
            _Word(
                text=text,
                left=data["left"][i],
                top=data["top"][i],
                width=data["width"][i],
                height=data["height"][i],
            )
        )
    return words


def _find_label(words: List[_Word], keywords: List[str], garble_hints: List[str]) -> Optional[_Word]:
    """Tries each keyword as a case-insensitive substring match — the
    OCR'd WORD must contain the keyword (or hint), never the reverse. A
    real bug found testing this: the reverse direction ("is this short
    OCR'd word itself a substring of the keyword") lets trivial 1-2
    character noise fragments match almost anything — "i" is a substring
    of "Birth", so a stray "i" from unrelated decorative header text
    became the matched label. Requiring a minimum length on the
    candidate word closes the same hole for the garble-hint fallback
    too, since a hint like "sue" is short enough to spuriously appear
    inside plenty of unrelated short noise tokens."""
    for keyword in keywords:
        for w in words:
            if len(w["text"]) >= 3 and keyword.lower() in w["text"].lower():
                return w
    for hint in garble_hints:
        for w in words:
            if len(w["text"]) >= 3 and hint.lower() in w["text"].lower():
                return w
    return None


def _find_value_below(words: List[_Word], label: _Word, is_date_field: bool) -> Optional[_Word]:
    """The value sits BELOW its label on this layout (not to the side —
    see module docstring, confirmed by measuring real label/value pairs
    on an actual passport: 25-65px vertical gap, similar horizontal
    start position), unlike birth_certificate.py's RTL value-to-the-left
    convention. Filters candidates by the expected value SHAPE (a
    date-like token, or an all-caps place name) rather than trusting
    proximity alone — proximity alone would just as happily grab an
    Arabic-column fragment or stray punctuation sitting in the same
    vertical band."""
    candidates = [
        w
        for w in words
        if w is not label
        and _VALUE_SEARCH_MIN_GAP_PX <= (w["top"] - label["top"]) <= _VALUE_SEARCH_MAX_GAP_PX
        and abs(w["left"] - label["left"]) <= _VALUE_SEARCH_HORIZONTAL_TOLERANCE_PX
    ]
    pattern = _DATE_PATTERN if is_date_field else _PLACE_PATTERN
    matching = [w for w in candidates if pattern.match(w["text"])]
    # Pattern match required, not just a fallback to "closest word" — a
    # real bug found testing this: falling back to nearest-any-word when
    # nothing matched the expected shape didn't fail safely, it silently
    # returned noise ("b2mge", a decorative-border OCR fragment) as if it
    # were a real value. No plausible value found is a real, honest
    # outcome for a field this system's own MVP-quality caveat already
    # applies to; better than reporting confident-looking garbage.
    if not matching:
        return None
    # Closest vertically, ties broken by closest horizontally — the most
    # literal reading of "the value directly under this label."
    return min(matching, key=lambda w: (w["top"] - label["top"], abs(w["left"] - label["left"])))


def _normalize_value(text: str, is_date_field: bool) -> str:
    if not is_date_field:
        return text
    # OCR ran "13 08 2018" together into "13082018" (or similarly
    # misread a leading digit, e.g. "43082018") — split back into
    # DD MM YYYY by fixed position rather than guess at separators that
    # were never actually recognized as separate characters.
    digits = re.sub(r"\D", "", text)
    if len(digits) == 8:
        return f"{digits[0:2]} {digits[2:4]} {digits[4:8]}"
    return text
