/**
 * Integration test for the opt-in auto-block feature (call-directory
 * blocking entries for high-confidence SCAM reports, distinct from the
 * warning-label override tested implicitly via callDirectoryExport). Off by
 * default -- see services/appSettings.ts:isAutoBlockHighRiskEnabled.
 * Skipped automatically if DATABASE_URL isn't set.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { pool } from "../db/client.js";
import { submitSpamReport } from "../services/spamReports.js";
import { suppressNumber, unsuppressNumber } from "../services/labelSuppressions.js";
import { setSetting } from "../services/appSettings.js";
import { getBlockedDigits } from "../services/callDirectoryExport.js";

const hasDb = Boolean(process.env.DATABASE_URL);
const SCAM_PHONE = "0399000444";
const SCAM_PHONE_E164 = "+84399000444";
const TELEMARKETING_PHONE = "0399000555";
const TELEMARKETING_PHONE_E164 = "+84399000555";

async function reportScamTenTimes(phoneRaw: string) {
  for (let i = 0; i < 10; i++) {
    await submitSpamReport({ phoneRaw, category: "SCAM", reporterRef: `blocking-test-device-${i}` });
  }
}

describe.skipIf(!hasDb)("auto-block high-risk numbers (requires seeded DATABASE_URL)", () => {
  beforeAll(async () => {
    await setSetting("auto_block_high_risk", false);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM spam_reports WHERE phone_normalized IN ($1, $2)`, [SCAM_PHONE_E164, TELEMARKETING_PHONE_E164]);
    await unsuppressNumber(SCAM_PHONE);
    await setSetting("auto_block_high_risk", false);
  });

  it("stays empty while the setting is off, even with 10 distinct SCAM reporters", async () => {
    await reportScamTenTimes(SCAM_PHONE);
    const blocked = await getBlockedDigits();
    expect(blocked).not.toContain("84399000444");
  });

  it("blocks a number with >=10 distinct SCAM reporters once enabled", async () => {
    await setSetting("auto_block_high_risk", true);
    const blocked = await getBlockedDigits();
    expect(blocked).toContain("84399000444");
  });

  it("does not block a number reported as TELEMARKETING even with 10 reporters", async () => {
    for (let i = 0; i < 10; i++) {
      await submitSpamReport({ phoneRaw: TELEMARKETING_PHONE, category: "TELEMARKETING", reporterRef: `telemarketing-test-${i}` });
    }
    const blocked = await getBlockedDigits();
    expect(blocked).not.toContain("84399000555");
  });

  it("an owner's suppression override wins over auto-blocking", async () => {
    await suppressNumber(SCAM_PHONE);
    const blocked = await getBlockedDigits();
    expect(blocked).not.toContain("84399000444");
  });
});
