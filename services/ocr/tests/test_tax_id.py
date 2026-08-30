from app.preprocessing import load_image, preprocess_for_ocr
from app.tax_id import extract_tax_id_fields

from .generate_fixtures import generate_tax_id_fixture


def test_extracts_some_fields_from_synthetic_tax_id():
    path = generate_tax_id_fixture()
    with open(path, "rb") as f:
        image_bytes = f.read()

    image = load_image(image_bytes)
    preprocessed = preprocess_for_ocr(image)

    raw_text, fields, overall_confidence = extract_tax_id_fields(preprocessed)

    field_names = {f.name for f in fields}
    assert len(field_names) > 0, f"expected at least one field to be found; raw_text={raw_text!r}"
    assert overall_confidence >= 0.0
