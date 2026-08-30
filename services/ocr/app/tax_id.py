"""Libyan Tax ID / Tax Card (البطاقة الضريبية) field extraction — see
app/arabic_form.py for the shared algorithm and its caveats. Keywords below
are best-guess Arabic terminology, UNTUNED against a real sample."""

from typing import List, Tuple

import numpy as np

from .arabic_form import extract_arabic_form_fields
from .schemas import ExtractedField

# See commercial_registration.py's comment on why each entry pairs a full
# phrase with a single-word fallback — Tesseract splits most 2-word Arabic
# labels into separate tokens, so a phrase-only keyword never matches.
_LABEL_KEYWORDS = {
    "company_name": ["اسم الشركة", "الشركة"],
    "tax_number": ["الرقم الضريبي", "الضريبي"],
    "issue_date": ["تاريخ الإصدار", "الإصدار"],
}


def extract_tax_id_fields(
    image: np.ndarray, lang: str = "ara"
) -> Tuple[str, List[ExtractedField], float]:
    return extract_arabic_form_fields(image, _LABEL_KEYWORDS, lang=lang)
