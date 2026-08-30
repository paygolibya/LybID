from app.chamber_of_commerce import extract_chamber_of_commerce_fields
from app.preprocessing import load_image, preprocess_for_ocr

from .generate_fixtures import generate_chamber_of_commerce_fixture


def test_extracts_some_fields_from_synthetic_chamber_of_commerce():
    path = generate_chamber_of_commerce_fixture()
    with open(path, "rb") as f:
        image_bytes = f.read()

    image = load_image(image_bytes)
    preprocessed = preprocess_for_ocr(image)

    raw_text, fields, overall_confidence = extract_chamber_of_commerce_fields(preprocessed)

    field_names = {f.name for f in fields}
    assert len(field_names) > 0, f"expected at least one field to be found; raw_text={raw_text!r}"
    assert overall_confidence >= 0.0
