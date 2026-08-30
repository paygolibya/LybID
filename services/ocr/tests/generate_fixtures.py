"""Generates synthetic test fixtures — no real PII, ever. Run once via
`python -m tests.generate_fixtures` (or automatically from conftest.py) to
(re)populate tests/fixtures/.

Passport: a rendered TD3 MRZ with correct ICAO 9303 check digits (so the
checksum-validation code path in app/passport.py is actually exercised, not
just "OCR found some text").

Birth certificate: a synthetic Arabic-labeled form loosely mirroring the
Libyan civil registry layout described (not copied) from the one real
sample seen in chat — label box to the right, value box to the left, per
field. Field values here are entirely made up.
"""

import os

from PIL import Image, ImageDraw, ImageFont

from .mrz_checksum import check_digit

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def _pad(s: str, length: int) -> str:
    return (s + "<" * length)[:length]


def build_passport_mrz() -> str:
    surname = "ALFTAISI"
    given_names = "SEIF"
    line1 = _pad(f"P<LBY{surname}<<{given_names}", 44)

    passport_no = _pad("N1234567", 9)
    passport_check = check_digit(passport_no)
    nationality = "LBY"
    dob = "010803"  # YYMMDD
    dob_check = check_digit(dob)
    sex = "M"
    expiry = "300101"
    expiry_check = check_digit(expiry)
    personal_no = _pad("", 14)
    personal_check = "0"

    composite_input = passport_no + passport_check + dob + dob_check + expiry + expiry_check + personal_no + personal_check
    composite_check = check_digit(composite_input)

    line2 = (
        passport_no
        + passport_check
        + nationality
        + dob
        + dob_check
        + sex
        + expiry
        + expiry_check
        + personal_no
        + personal_check
        + composite_check
    )
    assert len(line1) == 44, len(line1)
    assert len(line2) == 44, len(line2)
    return line1 + "\n" + line2


def _load_monospace_font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in ("DejaVuSansMono.ttf", "consola.ttf", "Courier New.ttf", "cour.ttf"):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _load_arabic_font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in (
        "NotoNaskhArabic-Regular.ttf",
        "NotoSansArabic-Regular.ttf",
        "arial.ttf",
        "tahoma.ttf",
    ):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    raise RuntimeError(
        "No Arabic-capable font found — install fonts-noto-core (Debian/Ubuntu) "
        "or equivalent before generating the birth-certificate fixture."
    )


def generate_passport_fixture() -> str:
    os.makedirs(FIXTURES_DIR, exist_ok=True)
    path = os.path.join(FIXTURES_DIR, "synthetic_passport.jpg")

    width, height = 1000, 700
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)

    title_font = _load_monospace_font(28)
    draw.text((40, 40), "PASSPORT (synthetic test fixture — no real data)", font=title_font, fill="black")

    mrz_font = _load_monospace_font(34)
    mrz_lines = build_passport_mrz().split("\n")
    draw.text((40, 560), mrz_lines[0], font=mrz_font, fill="black")
    draw.text((40, 610), mrz_lines[1], font=mrz_font, fill="black")

    image.save(path, "JPEG", quality=95)
    return path


def generate_birth_certificate_fixture() -> str:
    os.makedirs(FIXTURES_DIR, exist_ok=True)
    path = os.path.join(FIXTURES_DIR, "synthetic_birth_certificate.jpg")

    width, height = 1200, 900
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)

    label_font = _load_arabic_font(28)
    value_font = _load_arabic_font(28)

    # (label, value, y) — value box drawn to the left of the label box, per
    # the RTL layout app/birth_certificate.py expects.
    rows = [
        ("الاسم ثلاثي", "سيف الاسلام", 100),
        ("مكان الولادة", "طرابلس", 180),
        ("الجنس", "ذكر", 260),
        ("اسم الأب", "عبدالرزاق", 340),
        ("اسم الأم", "سناء", 420),
    ]
    for label, value, y in rows:
        draw.text((900, y), label, font=label_font, fill="black")
        draw.text((300, y), value, font=value_font, fill="black")

    image.save(path, "JPEG", quality=95)
    return path


def _generate_arabic_form_fixture(filename: str, rows: list) -> str:
    """Shared by the 3 Phase 3 (KYB) fixture generators below — same layout
    convention as generate_birth_certificate_fixture (label box to the
    right, value box to the left, per the RTL layout app/arabic_form.py
    expects). `rows` is a list of (label, value, y) tuples."""
    os.makedirs(FIXTURES_DIR, exist_ok=True)
    path = os.path.join(FIXTURES_DIR, filename)

    width, height = 1200, 900
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)

    label_font = _load_arabic_font(28)
    value_font = _load_arabic_font(28)

    for label, value, y in rows:
        draw.text((900, y), label, font=label_font, fill="black")
        draw.text((300, y), value, font=value_font, fill="black")

    image.save(path, "JPEG", quality=95)
    return path


def generate_commercial_registration_fixture() -> str:
    rows = [
        ("اسم الشركة", "شركة طرابلس للتجارة", 100),
        ("رقم السجل", "12345", 180),
        ("نوع النشاط", "تجارة عامة", 260),
        ("تاريخ الإصدار", "2020", 340),
    ]
    return _generate_arabic_form_fixture("synthetic_commercial_registration.jpg", rows)


def generate_chamber_of_commerce_fixture() -> str:
    rows = [
        ("اسم الشركة", "شركة طرابلس للتجارة", 100),
        ("رقم العضوية", "6789", 180),
        ("الغرفة التجارية", "غرفة طرابلس", 260),
        ("تاريخ الانتهاء", "2027", 340),
    ]
    return _generate_arabic_form_fixture("synthetic_chamber_of_commerce.jpg", rows)


def generate_tax_id_fixture() -> str:
    rows = [
        ("اسم الشركة", "شركة طرابلس للتجارة", 100),
        ("الرقم الضريبي", "998877", 180),
        ("تاريخ الإصدار", "2021", 260),
    ]
    return _generate_arabic_form_fixture("synthetic_tax_id.jpg", rows)


if __name__ == "__main__":
    print(generate_passport_fixture())
    print(generate_birth_certificate_fixture())
    print(generate_commercial_registration_fixture())
    print(generate_chamber_of_commerce_fixture())
    print(generate_tax_id_fixture())
