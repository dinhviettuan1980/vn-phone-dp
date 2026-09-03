import pytest

from normalizers.vietnam_phone import normalize_vietnam_phone

MOBILE_VARIANTS = [
    "0912345678",
    "0912 345 678",
    "0912.345.678",
    "+84 912 345 678",
    "84912345678",
    "(+84) 912345678",
    "+84912345678",
    "0912-345-678",
]


@pytest.mark.parametrize("raw", MOBILE_VARIANTS)
def test_mobile_variants_normalize_consistently(raw):
    result = normalize_vietnam_phone(raw)
    assert result.normalized == "+84912345678"
    assert result.type == "MOBILE"
    assert result.valid is True


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("0321234567", "+84321234567"),  # Viettel
        ("0701234567", "+84701234567"),  # Mobifone
        ("0811234567", "+84811234567"),  # Vinaphone
        ("0521234567", "+84521234567"),  # Vietnamobile
        ("0591234567", "+84591234567"),  # Gmobile
        ("0871234567", "+84871234567"),  # Itelecom
    ],
)
def test_carrier_mobile_prefixes(raw, expected):
    result = normalize_vietnam_phone(raw)
    assert result.normalized == expected
    assert result.type == "MOBILE"
    assert result.valid is True


def test_hanoi_landline():
    result = normalize_vietnam_phone("024 3856 1234")
    assert result.normalized == "+842438561234"
    assert result.type == "LANDLINE"


def test_hcmc_landline():
    result = normalize_vietnam_phone("028.3822.9999")
    assert result.normalized == "+842838229999"
    assert result.type == "LANDLINE"


def test_provincial_landline():
    result = normalize_vietnam_phone("0203 123 4567")
    assert result.type == "LANDLINE"
    assert result.valid is True


def test_1900_hotline_short():
    result = normalize_vietnam_phone("1900 1234")
    assert result.type == "HOTLINE_1900"
    assert result.valid is True


def test_1900_hotline_long():
    result = normalize_vietnam_phone("1900636563")
    assert result.type == "HOTLINE_1900"


def test_1800_hotline():
    result = normalize_vietnam_phone("1800 5678")
    assert result.type == "HOTLINE_1800"
    assert result.valid is True


def test_short_code_4digit():
    result = normalize_vietnam_phone("1068")
    assert result.type == "SHORT_CODE"
    assert result.valid is True


def test_short_code_3digit():
    result = normalize_vietnam_phone("191")
    assert result.type == "SHORT_CODE"


def test_empty_input():
    result = normalize_vietnam_phone("")
    assert result.valid is False
    assert result.normalized is None


def test_too_short_garbage():
    result = normalize_vietnam_phone("12")
    assert result.valid is False


def test_too_long_garbage_keeps_raw():
    result = normalize_vietnam_phone("091234567890123")
    assert result.valid is False
    assert result.raw == "091234567890123"


def test_malformed_with_letters():
    result = normalize_vietnam_phone("0912-ABC-678")
    assert result.valid is False


def test_unrecognized_but_plausible_prefix_not_discarded():
    result = normalize_vietnam_phone("0612345678")
    assert result.normalized is not None
    assert result.type == "UNKNOWN"
    assert result.valid is False


def test_bare_84_does_not_crash():
    result = normalize_vietnam_phone("84")
    assert result.valid is False


def test_whitespace_padded_input():
    result = normalize_vietnam_phone("   0912345678   ")
    assert result.normalized == "+84912345678"


@pytest.mark.parametrize("raw", ["0912345678", "not a phone", "", "1900xxxx"])
def test_raw_always_preserved(raw):
    assert normalize_vietnam_phone(raw).raw == raw
