import type { NormalizedPhoneResult, PhoneType } from "@phoneintel/shared-types";

// Mobile prefixes after the 2018 11→10 digit migration (national, 3 digits
// following the leading 0). Source: Circular 22/2014/TT-BTTTT reassignments,
// publicly documented by all four carriers.
const MOBILE_PREFIXES = new Set([
  // Viettel
  "032", "033", "034", "035", "036", "037", "038", "039", "086", "096", "097", "098",
  // Mobifone
  "070", "076", "077", "078", "079", "089", "090", "093",
  // Vinaphone
  "081", "082", "083", "084", "085", "088", "091", "094",
  // Vietnamobile
  "052", "056", "058", "092",
  // Gmobile
  "059", "099",
  // Itelecom
  "087",
]);

// Landline area codes (2-digit, after leading 0): Hanoi=24, HCMC=28.
const LANDLINE_2DIGIT_AREA = new Set(["24", "28"]);

function onlyDigitsKeepPlus(input: string): string {
  return input.replace(/[^\d+]/g, "");
}

function toNationalForm(digitsWithMaybePlus: string): string | null {
  let s = digitsWithMaybePlus;
  if (s.startsWith("+84")) {
    return "0" + s.slice(3);
  }
  if (s.startsWith("84") && s.length >= 11) {
    // country code without '+', e.g. 84912345678
    return "0" + s.slice(2);
  }
  if (s.startsWith("0")) {
    return s;
  }
  return null; // ambiguous — Vietnamese national numbers always start with 0
}

function classifyMobile(national: string): { type: PhoneType; valid: boolean; confidence: number } | null {
  if (national.length !== 10) return null;
  const prefix = national.slice(0, 3);
  if (MOBILE_PREFIXES.has(prefix)) {
    return { type: "MOBILE", valid: true, confidence: 0.95 };
  }
  return null;
}

function classifyLandline(national: string): { type: PhoneType; valid: boolean; confidence: number } | null {
  // Post-2017 unification, ALL VN landlines are 11 digits total (leading 0
  // + area code + local number), whether the area code is 2-digit
  // (Hanoi/HCMC) or 3-digit (provinces) — the local part absorbs the
  // difference. Area codes all start with "2".
  if (national.length !== 11 || national.slice(1, 2) !== "2") return null;
  if (LANDLINE_2DIGIT_AREA.has(national.slice(1, 3))) {
    return { type: "LANDLINE", valid: true, confidence: 0.85 };
  }
  return { type: "LANDLINE", valid: true, confidence: 0.75 };
}

function classifyHotline(national: string): { type: PhoneType; valid: boolean; confidence: number } | null {
  if (national.startsWith("1900") && national.length >= 8 && national.length <= 11) {
    return { type: "HOTLINE_1900", valid: true, confidence: 0.9 };
  }
  if (national.startsWith("1800") && national.length >= 8 && national.length <= 11) {
    return { type: "HOTLINE_1800", valid: true, confidence: 0.9 };
  }
  return null;
}

function classifyShortCode(national: string): { type: PhoneType; valid: boolean; confidence: number } | null {
  // Short codes: 3-6 digits, no leading 0 requirement (e.g. "191", "1068")
  if (/^\d{3,6}$/.test(national)) {
    return { type: "SHORT_CODE", valid: true, confidence: 0.5 };
  }
  return null;
}

export function normalizeVietnamPhone(rawInput: string): NormalizedPhoneResult {
  const raw = rawInput;
  const cleaned = onlyDigitsKeepPlus(rawInput.trim());

  if (cleaned.length === 0) {
    return { raw, normalized: null, country: "VN", type: "UNKNOWN", valid: false, normalization_confidence: 0, reason: "empty_input" };
  }

  const digitsOnly = cleaned.replace(/^\+/, "");

  // 1900/1800 hotlines are dialed without a leading 0 or country code, so
  // they must be checked before the national-prefix logic below.
  if (/^\d+$/.test(digitsOnly) && (digitsOnly.startsWith("1900") || digitsOnly.startsWith("1800"))) {
    const hotline = classifyHotline(digitsOnly);
    if (hotline) {
      return { raw, normalized: digitsOnly, country: "VN", type: hotline.type, valid: true, normalization_confidence: hotline.confidence };
    }
  }

  // Short codes (e.g. "1068", "191") never carry a country/national prefix.
  if (!cleaned.startsWith("0") && !cleaned.startsWith("+84") && !(cleaned.startsWith("84") && cleaned.length >= 11)) {
    const shortCode = classifyShortCode(digitsOnly);
    if (shortCode && digitsOnly.length <= 6) {
      return {
        raw,
        normalized: digitsOnly,
        country: "VN",
        type: "SHORT_CODE",
        valid: true,
        normalization_confidence: shortCode.confidence,
      };
    }
    return { raw, normalized: null, country: "VN", type: "UNKNOWN", valid: false, normalization_confidence: 0.1, reason: "no_recognizable_national_prefix" };
  }

  const national = toNationalForm(cleaned);
  if (!national || !/^\d+$/.test(national)) {
    return { raw, normalized: null, country: "VN", type: "UNKNOWN", valid: false, normalization_confidence: 0.1, reason: "malformed" };
  }

  const e164 = "+84" + national.slice(1);

  const classified =
    classifyHotline(national) ??
    classifyMobile(national) ??
    classifyLandline(national) ??
    null;

  if (classified) {
    return {
      raw,
      normalized: e164,
      country: "VN",
      type: classified.type,
      valid: classified.valid,
      normalization_confidence: classified.confidence,
    };
  }

  // Plausible length (E.164 for VN is 9-10 national digits after the 0) but
  // unrecognized prefix — keep it, don't discard, just mark low confidence.
  if (national.length === 10 || national.length === 11) {
    return {
      raw,
      normalized: e164,
      country: "VN",
      type: "UNKNOWN",
      valid: false,
      normalization_confidence: 0.3,
      reason: "unrecognized_prefix",
    };
  }

  return { raw, normalized: null, country: "VN", type: "UNKNOWN", valid: false, normalization_confidence: 0.1, reason: "invalid_length" };
}
