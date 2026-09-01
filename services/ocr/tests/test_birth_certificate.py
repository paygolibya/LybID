from app.birth_certificate import extract_birth_certificate_fields
from app.preprocessing import load_image

from .generate_fixtures import generate_birth_certificate_fixture


def test_extracts_some_fields_from_synthetic_birth_certificate():
    path = generate_birth_certificate_fixture()
    with open(path, "rb") as f:
        image_bytes = f.read()

    # Raw image, not preprocess_for_ocr(image) — this extractor now runs
    # its own multi-variant preprocessing internally (see its module
    # docstring).
    image = load_image(image_bytes)

    raw_text, fields, overall_confidence = extract_birth_certificate_fields(image)

    # This is explicitly the untuned, MVP-quality path (see the module
    # docstring) — the bar here is "the pipeline runs and finds *something*
    # on a clean synthetic render," not "matches production accuracy."
    field_names = {f.name for f in fields}
    assert len(field_names) > 0, f"expected at least one field to be found; raw_text={raw_text!r}"
    assert overall_confidence >= 0.0
