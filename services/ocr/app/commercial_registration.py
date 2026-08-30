"""Libyan Commercial Registration Certificate (السجل التجاري) field
extraction — see app/arabic_form.py for the shared algorithm and its
caveats. Keywords below are best-guess Arabic terminology, UNTUNED against
a real sample."""

from typing import List, Tuple

import numpy as np

from .arabic_form import extract_arabic_form_fields
from .schemas import ExtractedField

# Tesseract's word-level bounding boxes split most 2-word Arabic labels
# into separate tokens (confirmed empirically against the synthetic
# fixture) — a keyword list containing only the full 2-word phrase never
# matches any single token. Each entry below pairs the full phrase with a
# single-word fallback (the label's more distinctive word), same pattern
# app/birth_certificate.py already uses for some of its own fields.
_LABEL_KEYWORDS = {
    "company_name": ["اسم الشركة", "الشركة"],
    "registration_number": ["رقم السجل", "السجل"],
    "activity_type": ["نوع النشاط", "النشاط"],
    "issue_date": ["تاريخ الإصدار", "الإصدار"],
}


def extract_commercial_registration_fields(
    image: np.ndarray, lang: str = "ara"
) -> Tuple[str, List[ExtractedField], float]:
    return extract_arabic_form_fields(image, _LABEL_KEYWORDS, lang=lang)
