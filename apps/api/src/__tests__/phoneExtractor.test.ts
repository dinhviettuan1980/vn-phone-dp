import { describe, it, expect } from "vitest";
import { extractPhoneCandidatesFromText, extractPhoneCandidatesFromHtml } from "../extractors/phoneExtractor.js";

describe("extractPhoneCandidatesFromText", () => {
  it("extracts a phone number with surrounding context", () => {
    const text =
      "Công ty ABC cung cấp dịch vụ bảo hiểm. Hotline chăm sóc khách hàng: 0912 345 678. Địa chỉ tại Hà Nội.";
    const candidates = extractPhoneCandidatesFromText(text);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].phoneRaw).toBe("0912 345 678");
    expect(candidates[0].contextBefore).toContain("Hotline chăm sóc khách hàng");
    expect(candidates[0].contextAfter).toContain("Địa chỉ tại Hà Nội");
    expect(candidates[0].extractionMethod).toBe("REGEX_TEXT");
  });

  it("extracts multiple phone numbers from the same text as separate candidates", () => {
    const text = "Liên hệ 0912345678 hoặc 0987654321 để được tư vấn.";
    const candidates = extractPhoneCandidatesFromText(text);
    expect(candidates.map((c) => c.phoneRaw)).toEqual(["0912345678", "0987654321"]);
  });

  it("gives higher confidence when a contextual keyword is present", () => {
    const withKeyword = extractPhoneCandidatesFromText("Hotline: 0912345678");
    const withoutKeyword = extractPhoneCandidatesFromText("Mã đơn hàng liên quan 0912345678 abc");
    expect(withKeyword[0].confidence).toBeGreaterThan(withoutKeyword[0].confidence);
  });

  it("does not crash and returns no candidates for text with no phone-shaped digits", () => {
    const candidates = extractPhoneCandidatesFromText("Không có số điện thoại nào ở đây cả.");
    expect(candidates).toHaveLength(0);
  });

  it("captures a 1900 hotline embedded in text", () => {
    const candidates = extractPhoneCandidatesFromText("Tổng đài hỗ trợ: 1900 1234 hoạt động 24/7.");
    expect(candidates[0].phoneRaw.replace(/\s/g, "")).toBe("19001234");
  });
});

describe("extractPhoneCandidatesFromHtml", () => {
  it("extracts a tel: href with high confidence", () => {
    const html = `<a href="tel:0912345678">Gọi ngay</a>`;
    const candidates = extractPhoneCandidatesFromHtml(html);
    const telCandidate = candidates.find((c) => c.extractionMethod === "TEL_HREF");
    expect(telCandidate?.phoneRaw).toBe("0912345678");
    expect(telCandidate?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("extracts a phone number from visible body text, ignoring script/style content", () => {
    const html = `
      <html><head><style>.x{content:"0999999999"}</style></head>
      <body><script>var fake = "0888888888";</script>
      <p>Hotline: 0912345678</p></body></html>`;
    const candidates = extractPhoneCandidatesFromHtml(html);
    const raws = candidates.map((c) => c.phoneRaw.replace(/\s/g, ""));
    expect(raws).toContain("0912345678");
    expect(raws).not.toContain("0999999999");
    expect(raws).not.toContain("0888888888");
  });

  it("extracts a phone number from the <title> tag", () => {
    const html = `<html><head><title>Liên hệ 0912345678</title></head><body></body></html>`;
    const candidates = extractPhoneCandidatesFromHtml(html);
    const titleCandidate = candidates.find((c) => c.extractionMethod === "REGEX_TITLE");
    expect(titleCandidate?.phoneRaw).toBe("0912345678");
  });

  it("extracts a phone number from the meta description", () => {
    const html = `<html><head><meta name="description" content="Gọi 0912345678 để đặt hàng"></head><body></body></html>`;
    const candidates = extractPhoneCandidatesFromHtml(html);
    const metaCandidate = candidates.find((c) => c.extractionMethod === "REGEX_META_DESCRIPTION");
    expect(metaCandidate?.phoneRaw).toBe("0912345678");
  });
});
