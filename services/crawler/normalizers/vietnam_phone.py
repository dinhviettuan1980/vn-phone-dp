"""VietnamPhoneNormalizer — Python port of apps/api/src/normalizers/vietnamPhone.ts.

Both implementations must stay in sync: same prefix tables, same rules.
The TS version is the API's normalizer; this one runs inside the crawler
so observations are normalized at extraction time.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

# Mobile prefixes after the 2018 11->10 digit migration.
MOBILE_PREFIXES = {
    # Viettel
    "032", "033", "034", "035", "036", "037", "038", "039", "086", "096", "097", "098",
    # Mobifone
    "070", "076", "077", "078", "079", "089", "090", "093",
    # Vinaphone
    "081", "082", "083", "084", "085", "088", "091", "094",
    # Vietnamobile
    "052", "056", "058", "092",
    # Gmobile
    "059", "099",
    # Itelecom
    "087",
}

LANDLINE_2DIGIT_AREA = {"24", "28"}

_NON_DIGIT_PLUS = re.compile(r"[^\d+]")
_DIGITS_ONLY = re.compile(r"^\d+$")
_SHORT_CODE = re.compile(r"^\d{3,6}$")


@dataclass
class NormalizedPhoneResult:
    raw: str
    normalized: Optional[str]
    country: str
    type: str
    valid: bool
    normalization_confidence: float
    reason: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "raw": self.raw,
            "normalized": self.normalized,
            "country": self.country,
            "type": self.type,
            "valid": self.valid,
            "normalization_confidence": self.normalization_confidence,
            "reason": self.reason,
        }


def _only_digits_keep_plus(s: str) -> str:
    return _NON_DIGIT_PLUS.sub("", s)


def _to_national_form(cleaned: str) -> Optional[str]:
    if cleaned.startswith("+84"):
        return "0" + cleaned[3:]
    if cleaned.startswith("84") and len(cleaned) >= 11:
        return "0" + cleaned[2:]
    if cleaned.startswith("0"):
        return cleaned
    return None


def _classify_mobile(national: str):
    if len(national) != 10:
        return None
    prefix = national[:3]
    if prefix in MOBILE_PREFIXES:
        return ("MOBILE", True, 0.95)
    return None


def _classify_landline(national: str):
    # Post-2017 unification: all VN landlines are 11 digits total.
    if len(national) != 11 or national[1] != "2":
        return None
    if national[1:3] in LANDLINE_2DIGIT_AREA:
        return ("LANDLINE", True, 0.85)
    return ("LANDLINE", True, 0.75)


def _classify_hotline(national: str):
    if national.startswith("1900") and 8 <= len(national) <= 11:
        return ("HOTLINE_1900", True, 0.9)
    if national.startswith("1800") and 8 <= len(national) <= 11:
        return ("HOTLINE_1800", True, 0.9)
    return None


def normalize_vietnam_phone(raw_input: str) -> NormalizedPhoneResult:
    raw = raw_input
    cleaned = _only_digits_keep_plus(raw_input.strip())

    if len(cleaned) == 0:
        return NormalizedPhoneResult(raw, None, "VN", "UNKNOWN", False, 0.0, "empty_input")

    digits_only = cleaned[1:] if cleaned.startswith("+") else cleaned

    if _DIGITS_ONLY.match(digits_only) and (digits_only.startswith("1900") or digits_only.startswith("1800")):
        hotline = _classify_hotline(digits_only)
        if hotline:
            phone_type, valid, confidence = hotline
            return NormalizedPhoneResult(raw, digits_only, "VN", phone_type, valid, confidence)

    is_country_prefixed = cleaned.startswith("84") and len(cleaned) >= 11
    if not cleaned.startswith("0") and not cleaned.startswith("+84") and not is_country_prefixed:
        if _SHORT_CODE.match(digits_only) and len(digits_only) <= 6:
            return NormalizedPhoneResult(raw, digits_only, "VN", "SHORT_CODE", True, 0.5)
        return NormalizedPhoneResult(raw, None, "VN", "UNKNOWN", False, 0.1, "no_recognizable_national_prefix")

    national = _to_national_form(cleaned)
    if not national or not _DIGITS_ONLY.match(national):
        return NormalizedPhoneResult(raw, None, "VN", "UNKNOWN", False, 0.1, "malformed")

    e164 = "+84" + national[1:]

    classified = _classify_hotline(national) or _classify_mobile(national) or _classify_landline(national)
    if classified:
        phone_type, valid, confidence = classified
        return NormalizedPhoneResult(raw, e164, "VN", phone_type, valid, confidence)

    if len(national) in (10, 11):
        return NormalizedPhoneResult(raw, e164, "VN", "UNKNOWN", False, 0.3, "unrecognized_prefix")

    return NormalizedPhoneResult(raw, None, "VN", "UNKNOWN", False, 0.1, "invalid_length")
