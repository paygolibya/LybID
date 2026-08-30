"""ICAO 9303 MRZ check-digit algorithm — used only to build a *valid*
synthetic MRZ for test fixtures (weights 7,3,1 repeating; '<' = 0, digits as
themselves, letters A-Z = 10-35; sum of value*weight mod 10)."""

_WEIGHTS = [7, 3, 1]


def _char_value(c: str) -> int:
    if c == "<":
        return 0
    if c.isdigit():
        return int(c)
    return ord(c.upper()) - ord("A") + 10


def check_digit(field: str) -> str:
    total = sum(_char_value(c) * _WEIGHTS[i % 3] for i, c in enumerate(field))
    return str(total % 10)
