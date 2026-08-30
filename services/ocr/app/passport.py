"""Passport MRZ (machine-readable zone) extraction via PassportEye.

PassportEye validates OCR'd MRZ digits against the MRZ's own ICAO 9303
check digits — this is the strongest available defense against passport OCR
misreads, since it's self-checking rather than trusting raw OCR blindly.
Exact attribute names below are per PassportEye's documented `MRZ` object;
flagged for verification once a real (non-synthetic) sample is available to
test against — see the Phase 1 plan's note on this.
"""

import tempfile
from typing import List, Tuple

from passporteye import read_mrz

from .schemas import ExtractedField

# Maps an MRZ field name to the boolean checksum-validity attribute
# PassportEye computes for it (fields without a check digit, like names,
# aren't in this map).
_CHECK_ATTR_BY_FIELD = {
    "number": "valid_number",
    "date_of_birth": "valid_date_of_birth",
    "expiration_date": "valid_expiration_date",
    "personal_number": "valid_personal_number",
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
    for name in (
        "surname",
        "names",
        "number",
        "nationality",
        "date_of_birth",
        "sex",
        "expiration_date",
        "country",
        "type",
        "personal_number",
    ):
        value = data.get(name)
        if not value:
            continue

        check_attr = _CHECK_ATTR_BY_FIELD.get(name)
        if check_attr is not None:
            checksum_valid = bool(data.get(check_attr, False))
            confidence = _CHECKSUM_VALID_CONFIDENCE if checksum_valid else _CHECKSUM_INVALID_CONFIDENCE
        else:
            confidence = _NO_CHECKSUM_CONFIDENCE

        fields.append(ExtractedField(name=name, value=str(value), confidence=confidence))

    # valid_score is PassportEye's own 0-100 composite confidence across all
    # checksums in the MRZ (including the overall composite check digit).
    overall_confidence = float(data.get("valid_score", 0) or 0) / 100.0
    return raw_text, fields, overall_confidence
