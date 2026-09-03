import { describe, it, expect } from "vitest";
import { normalizeVietnamPhone } from "../normalizers/vietnamPhone.js";

describe("normalizeVietnamPhone", () => {
  // --- format variations, same mobile number ---
  const mobileVariants = [
    "0912345678",
    "0912 345 678",
    "0912.345.678",
    "+84 912 345 678",
    "84912345678",
    "(+84) 912345678",
    "+84912345678",
    "0912-345-678",
  ];
  for (const input of mobileVariants) {
    it(`normalizes mobile variant "${input}" to +84912345678`, () => {
      const result = normalizeVietnamPhone(input);
      expect(result.normalized).toBe("+84912345678");
      expect(result.type).toBe("MOBILE");
      expect(result.valid).toBe(true);
    });
  }

  // --- one number per major carrier prefix ---
  const carrierMobiles: Array<[string, string]> = [
    ["0321234567", "+84321234567"], // Viettel
    ["0701234567", "+84701234567"], // Mobifone
    ["0811234567", "+84811234567"], // Vinaphone
    ["0521234567", "+84521234567"], // Vietnamobile
    ["0591234567", "+84591234567"], // Gmobile
    ["0871234567", "+84871234567"], // Itelecom
  ];
  for (const [input, expected] of carrierMobiles) {
    it(`normalizes carrier mobile ${input}`, () => {
      const result = normalizeVietnamPhone(input);
      expect(result.normalized).toBe(expected);
      expect(result.type).toBe("MOBILE");
      expect(result.valid).toBe(true);
    });
  }

  // --- landline ---
  it("normalizes Hanoi landline (024)", () => {
    const result = normalizeVietnamPhone("024 3856 1234");
    expect(result.normalized).toBe("+842438561234");
    expect(result.type).toBe("LANDLINE");
    expect(result.valid).toBe(true);
  });

  it("normalizes HCMC landline (028)", () => {
    const result = normalizeVietnamPhone("028.3822.9999");
    expect(result.normalized).toBe("+842838229999");
    expect(result.type).toBe("LANDLINE");
  });

  it("normalizes a provincial landline (10-digit 02x)", () => {
    const result = normalizeVietnamPhone("0203 123 4567");
    expect(result.type).toBe("LANDLINE");
    expect(result.valid).toBe(true);
  });

  // --- hotlines ---
  it("normalizes a 1900 hotline", () => {
    const result = normalizeVietnamPhone("1900 1234");
    expect(result.type).toBe("HOTLINE_1900");
    expect(result.valid).toBe(true);
  });

  it("normalizes a 1900 hotline with 6 digits", () => {
    const result = normalizeVietnamPhone("1900636563");
    expect(result.type).toBe("HOTLINE_1900");
  });

  it("normalizes a 1800 toll-free hotline", () => {
    const result = normalizeVietnamPhone("1800 5678");
    expect(result.type).toBe("HOTLINE_1800");
    expect(result.valid).toBe(true);
  });

  // --- short codes ---
  it("normalizes a short code", () => {
    const result = normalizeVietnamPhone("1068");
    expect(result.type).toBe("SHORT_CODE");
    expect(result.valid).toBe(true);
  });

  it("normalizes a 3-digit short code", () => {
    const result = normalizeVietnamPhone("191");
    expect(result.type).toBe("SHORT_CODE");
  });

  // --- malformed / ambiguous ---
  it("flags empty input", () => {
    const result = normalizeVietnamPhone("");
    expect(result.valid).toBe(false);
    expect(result.normalized).toBeNull();
  });

  it("flags too-short garbage", () => {
    const result = normalizeVietnamPhone("12");
    expect(result.valid).toBe(false);
  });

  it("flags too-long garbage without discarding raw", () => {
    const result = normalizeVietnamPhone("091234567890123");
    expect(result.valid).toBe(false);
    expect(result.raw).toBe("091234567890123");
  });

  it("flags letters mixed into the number as malformed", () => {
    const result = normalizeVietnamPhone("0912-ABC-678");
    expect(result.valid).toBe(false);
  });

  it("keeps an unrecognized-but-plausible 10-digit prefix as UNKNOWN, not discarded", () => {
    // "061" is not an assigned mobile prefix and doesn't start with "2"
    // (landline) or 1900/1800 (hotline) — plausible length, unknown type.
    const result = normalizeVietnamPhone("0612345678");
    expect(result.normalized).not.toBeNull();
    expect(result.type).toBe("UNKNOWN");
    expect(result.valid).toBe(false);
  });

  it("does not crash on a bare '84' with insufficient digits", () => {
    const result = normalizeVietnamPhone("84");
    expect(result.valid).toBe(false);
  });

  it("handles whitespace-padded input", () => {
    const result = normalizeVietnamPhone("   0912345678   ");
    expect(result.normalized).toBe("+84912345678");
  });

  it("every result always preserves the original raw string", () => {
    const inputs = ["0912345678", "not a phone", "", "1900xxxx"];
    for (const input of inputs) {
      expect(normalizeVietnamPhone(input).raw).toBe(input);
    }
  });
});
