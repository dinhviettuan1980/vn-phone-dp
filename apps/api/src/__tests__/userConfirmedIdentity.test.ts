/**
 * Integration test for the user-confirmed identity import path (phone
 * owner personally vetting/submitting a label, e.g. transcribed from a
 * third-party caller-ID app -- not crawled public evidence). Asserts
 * against the real DB, same pattern as integration.pipeline.test.ts.
 * Skipped automatically if DATABASE_URL isn't set.
 */
import { describe, it, expect, afterAll } from "vitest";
import { pool } from "../db/client.js";
import { importUserConfirmedIdentities } from "../services/userConfirmedIdentity.js";
import { lookupPhone } from "../services/lookup.js";

const hasDb = Boolean(process.env.DATABASE_URL);
const TEST_PHONE = "0399000111";
const TEST_NAME = "Test User Confirmed Identity";

describe.skipIf(!hasDb)("user-confirmed identity import (requires seeded DATABASE_URL)", () => {
  afterAll(async () => {
    // Joins through phone_observations.context_text (matched exactly, no
    // scan needed thanks to the small result set) to find raw_document ids
    // -- NOT a LIKE scan over raw_documents.raw_content, which has no index
    // and, on the real shared dev/prod DB after 2+ weeks of continuous
    // crawling, is a multi-second sequential scan over a large TEXT column.
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
      DELETE FROM phone_numbers WHERE phone_e164 = '+84399000111'
      `,
      [TEST_NAME]
    );
  }, 15000);

  it("creates a CONFIRMED, HIGH-trust identity reachable via lookup", async () => {
    const results = await importUserConfirmedIdentities([
      { phoneRaw: TEST_PHONE, displayName: TEST_NAME, identityType: "BUSINESS", category: "DELIVERY", noteSource: "Truecaller" },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true);
    expect(results[0].phoneNormalized).toBe("+84399000111");

    const looked_up = await lookupPhone(TEST_PHONE);
    const identity = looked_up.identities.find((i) => i.name === TEST_NAME);
    expect(identity).toBeDefined();
    expect(identity?.status).toBe("CONFIRMED");
    expect(identity?.confidence).toBe(95);
  });

  it("re-submitting the same entry updates in place instead of duplicating", async () => {
    await importUserConfirmedIdentities([{ phoneRaw: TEST_PHONE, displayName: TEST_NAME, category: "SPAM" }]);

    const looked_up = await lookupPhone(TEST_PHONE);
    const matches = looked_up.identities.filter((i) => i.name === TEST_NAME);
    expect(matches).toHaveLength(1);
    expect(matches[0].category).toBe("SPAM"); // category updated by the resubmit
    expect(matches[0].evidence_count).toBe(2); // but evidence accumulates, not overwritten
  });

  it("skips an entry with an unparseable phone number instead of throwing", async () => {
    const results = await importUserConfirmedIdentities([{ phoneRaw: "not-a-phone", displayName: "Should Skip" }]);
    expect(results[0].valid).toBe(false);
    expect(results[0].skippedReason).toBe("invalid_phone_format");
  });
});
