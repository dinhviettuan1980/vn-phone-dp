/**
 * Integration test for crowdsourced spam/scam reporting (the
 * "report_count distinct reporters -> risk level" pipeline), asserting
 * against the real DB, same pattern as userConfirmedIdentity.test.ts.
 * Skipped automatically if DATABASE_URL isn't set.
 */
import { describe, it, expect, afterAll } from "vitest";
import { pool } from "../db/client.js";
import { submitSpamReport, getSpamSummary, computeRiskLevel } from "../services/spamReports.js";
import { lookupPhone } from "../services/lookup.js";

const hasDb = Boolean(process.env.DATABASE_URL);
const TEST_PHONE = "0399000222";
const TEST_PHONE_E164 = "+84399000222";

describe("computeRiskLevel", () => {
  it("thresholds on distinct reporters, not raw report count", () => {
    expect(computeRiskLevel(0)).toBe("NONE");
    expect(computeRiskLevel(1)).toBe("LOW");
    expect(computeRiskLevel(2)).toBe("LOW");
    expect(computeRiskLevel(3)).toBe("MEDIUM");
    expect(computeRiskLevel(9)).toBe("MEDIUM");
    expect(computeRiskLevel(10)).toBe("HIGH");
  });
});

describe.skipIf(!hasDb)("spam reporting (requires seeded DATABASE_URL)", () => {
  afterAll(async () => {
    await pool.query(`DELETE FROM spam_reports WHERE phone_normalized = $1`, [TEST_PHONE_E164]);
  });

  it("rejects an unparseable phone number instead of throwing", async () => {
    const result = await submitSpamReport({ phoneRaw: "not-a-phone" });
    expect(result.valid).toBe(false);
    expect(result.skippedReason).toBe("invalid_phone_format");
  });

  it("accumulates distinct reporters and escalates risk level", async () => {
    await submitSpamReport({ phoneRaw: TEST_PHONE, category: "SCAM", reporterRef: "device-a" });
    let summary = await getSpamSummary(TEST_PHONE_E164);
    expect(summary.reportCount).toBe(1);
    expect(summary.distinctReporters).toBe(1);
    expect(summary.riskLevel).toBe("LOW");

    // Same reporter reporting again must not inflate distinct_reporters.
    await submitSpamReport({ phoneRaw: TEST_PHONE, category: "SCAM", reporterRef: "device-a" });
    summary = await getSpamSummary(TEST_PHONE_E164);
    expect(summary.reportCount).toBe(2);
    expect(summary.distinctReporters).toBe(1);
    expect(summary.riskLevel).toBe("LOW");

    await submitSpamReport({ phoneRaw: TEST_PHONE, category: "SPAM", reporterRef: "device-b" });
    await submitSpamReport({ phoneRaw: TEST_PHONE, category: "SCAM", reporterRef: "device-c" });
    summary = await getSpamSummary(TEST_PHONE_E164);
    expect(summary.distinctReporters).toBe(3);
    expect(summary.riskLevel).toBe("MEDIUM");
    expect(summary.topCategory).toBe("SCAM");
    expect(summary.categoryBreakdown.SCAM).toBe(3);
    expect(summary.categoryBreakdown.SPAM).toBe(1);
  });

  it("surfaces in the phone lookup response even with no crawled identity", async () => {
    await submitSpamReport({ phoneRaw: TEST_PHONE, reporterRef: "device-d" });
    const result = await lookupPhone(TEST_PHONE);
    expect(result.spam.report_count).toBeGreaterThan(0);
    expect(result.spam.risk_level).not.toBe("NONE");
  });
});
