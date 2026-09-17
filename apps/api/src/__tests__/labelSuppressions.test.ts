/**
 * Integration test for the "don't label this number" settings feature --
 * lets the phone owner silence a known number (or a spam-flagged one)
 * without deleting the underlying identity/report data. Asserts against the
 * real DB and the call-directory export, same pattern as the other
 * integration tests. Skipped automatically if DATABASE_URL isn't set.
 */
import { describe, it, expect, afterAll } from "vitest";
import { pool } from "../db/client.js";
import { suppressNumber, unsuppressNumber, isSuppressed } from "../services/labelSuppressions.js";
import { importUserConfirmedIdentities } from "../services/userConfirmedIdentity.js";
import { getCallDirectoryEntries } from "../services/callDirectoryExport.js";

const hasDb = Boolean(process.env.DATABASE_URL);
const TEST_PHONE = "0399000333";
const TEST_PHONE_E164 = "+84399000333";
const TEST_NAME = "Test Suppression Identity";

describe.skipIf(!hasDb)("label suppression (requires seeded DATABASE_URL)", () => {
  afterAll(async () => {
    await pool.query(`DELETE FROM label_suppressions WHERE phone_normalized = $1`, [TEST_PHONE_E164]);
    await pool.query(
      `
      WITH target_observations AS (
        SELECT id, raw_document_id FROM phone_observations WHERE context_text = $1
      ), target_identities AS (
        SELECT id FROM phone_identities WHERE claim_source = 'user_confirmed_v1' AND display_name = $1
      ), del_evidence AS (
        DELETE FROM phone_identity_evidence WHERE phone_identity_id IN (SELECT id FROM target_identities)
      ), del_identities AS (
        DELETE FROM phone_identities WHERE id IN (SELECT id FROM target_identities)
      ), del_observations AS (
        DELETE FROM phone_observations WHERE id IN (SELECT id FROM target_observations)
      ), del_raw_documents AS (
        DELETE FROM raw_documents WHERE id IN (SELECT raw_document_id FROM target_observations)
      )
      DELETE FROM phone_numbers WHERE phone_e164 = $2
      `,
      [TEST_NAME, TEST_PHONE_E164]
    );
  }, 15000);

  it("round-trips suppress -> isSuppressed -> unsuppress", async () => {
    expect(await isSuppressed(TEST_PHONE_E164)).toBe(false);

    const suppressed = await suppressNumber(TEST_PHONE, "test reason");
    expect(suppressed.valid).toBe(true);
    expect(suppressed.phoneNormalized).toBe(TEST_PHONE_E164);
    expect(await isSuppressed(TEST_PHONE_E164)).toBe(true);

    await unsuppressNumber(TEST_PHONE);
    expect(await isSuppressed(TEST_PHONE_E164)).toBe(false);
  });

  it("rejects an unparseable phone number instead of throwing", async () => {
    const result = await suppressNumber("not-a-phone");
    expect(result.valid).toBe(false);
  });

  it("drops a suppressed number from the call-directory export even with a HIGH-trust identity", async () => {
    await importUserConfirmedIdentities([
      { phoneRaw: TEST_PHONE, displayName: TEST_NAME, identityType: "BUSINESS" },
    ]);

    let entries = await getCallDirectoryEntries();
    expect(entries.some((e) => e.phoneDigits === "84399000333")).toBe(true);

    await suppressNumber(TEST_PHONE);
    entries = await getCallDirectoryEntries();
    expect(entries.some((e) => e.phoneDigits === "84399000333")).toBe(false);

    await unsuppressNumber(TEST_PHONE);
    entries = await getCallDirectoryEntries();
    expect(entries.some((e) => e.phoneDigits === "84399000333")).toBe(true);
  });
});
