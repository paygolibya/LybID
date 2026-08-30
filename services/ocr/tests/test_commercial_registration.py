from app.commercial_registration import extract_commercial_registration_fields
from app.preprocessing import load_image, preprocess_for_ocr

from .generate_fixtures import generate_commercial_registration_fixture


def test_extracts_some_fields_from_synthetic_commercial_registration():
    path = generate_commercial_registration_fixture()
    with open(path, "rb") as f:
        image_bytes = f.read()

    image = load_image(image_bytes)
    preprocessed = preprocess_for_ocr(image)

    raw_text, fields, overall_confidence = extract_commercial_registration_fields(preprocessed)

    # Same posture as test_birth_certificate.py: the bar is "the pipeline
    # runs and finds *something* on a clean synthetic render," not "matches
    # production accuracy" — see app/arabic_form.py's module docstring.
    field_names = {f.name for f in fields}
    assert len(field_names) > 0, f"expected at least one field to be found; raw_text={raw_text!r}"
    assert overall_confidence >= 0.0
