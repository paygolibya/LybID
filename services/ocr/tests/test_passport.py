from app.passport import extract_passport_fields

from .generate_fixtures import generate_passport_fixture


def test_extracts_mrz_fields_from_synthetic_passport():
    path = generate_passport_fixture()
    with open(path, "rb") as f:
        image_bytes = f.read()

    raw_text, fields, overall_confidence = extract_passport_fields(image_bytes)

    field_names = {f.name for f in fields}
    assert "number" in field_names, f"MRZ number not found; raw_text={raw_text!r}"
    assert "nationality" in field_names

    number_field = next(f for f in fields if f.name == "number")
    assert number_field.value.startswith("N1234567")

    # The synthetic fixture's MRZ has correct ICAO check digits (see
    # mrz_checksum.py) — a successful read should score highly.
    assert overall_confidence > 0.5, f"expected a confident checksum-validated read, got {overall_confidence}"


def test_returns_zero_confidence_for_a_non_passport_image():
    from PIL import Image
    import io

    blank = Image.new("RGB", (200, 200), "white")
    buf = io.BytesIO()
    blank.save(buf, format="JPEG")

    raw_text, fields, overall_confidence = extract_passport_fields(buf.getvalue())
    assert fields == []
    assert overall_confidence == 0.0
