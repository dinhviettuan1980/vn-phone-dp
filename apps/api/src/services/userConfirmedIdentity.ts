import crypto from "node:crypto";
import { pool } from "../db/client.js";
import { normalizeVietnamPhone } from "../normalizers/vietnamPhone.js";
import type { IdentityCategory, IdentityType } from "@phoneintel/shared-types";

/**
 * Identities the phone's owner personally vetted and chose to submit (e.g.
 * transcribed from a caller-ID app's own label on a real incoming call),
 * NOT crawled public evidence. Still goes through the same
 * raw_documents -> phone_observations -> phone_identities chain as crawled
 * data so provenance stays uniform and auditable -- the "raw_document" here
 * is just a record of what was submitted and from where, not a fetched
 * webpage. trust_level = HIGH is deliberate: the human user is the review
 * step (same role a person manually flipping trust_level after reviewing
 * an auto-discovered source plays elsewhere in this pipeline), not a
 * shortcut around it.
 */
const SOURCE_NAME = "Người dùng tự xác nhận";

async function ensureUserSubmittedSource(): Promise<string> {
  const existing = await pool.query<{ id: string }>("SELECT id FROM data_sources WHERE name = $1", [SOURCE_NAME]);
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO data_sources (name, base_url, source_type, trust_level, robots_checked, license_notes)
     VALUES ($1, 'manual://user-confirmed', 'USER_SUBMITTED', 'HIGH', true, $2)
     RETURNING id`,
    [
      SOURCE_NAME,
      "Người dùng tự đọc và xác nhận nhãn định danh (vd: từ app caller-ID khác), không phải dữ liệu crawl tự động.",
    ]
  );
  return inserted.rows[0].id;
}

export interface UserConfirmedEntry {
  phoneRaw: string;
  displayName: string;
  identityType?: IdentityType;
  category?: IdentityCategory;
  noteSource?: string; // e.g. "Truecaller" -- recorded in the raw_document for audit, not shown to end users
}

export interface UserConfirmedResult {
  phoneRaw: string;
  phoneNormalized: string | null;
  valid: boolean;
  identityId?: string;
  skippedReason?: string;
}

export async function importUserConfirmedIdentities(entries: UserConfirmedEntry[]): Promise<UserConfirmedResult[]> {
  const sourceId = await ensureUserSubmittedSource();
  const results: UserConfirmedResult[] = [];

  for (const entry of entries) {
    const normalized = normalizeVietnamPhone(entry.phoneRaw);
    if (!normalized.normalized) {
      results.push({ phoneRaw: entry.phoneRaw, phoneNormalized: null, valid: false, skippedReason: "invalid_phone_format" });
      continue;
    }

    const rawContent = `phone=${entry.phoneRaw} display_name=${entry.displayName} note_source=${entry.noteSource ?? "unknown"}`;
    const contentHash = crypto.createHash("sha256").update(rawContent).digest("hex");
    const url = `manual://user-confirmed/${normalized.normalized}/${Date.now()}`;

    const rawDoc = await pool.query<{ id: string }>(
      `INSERT INTO raw_documents (source_id, url, final_url, content_type, http_status, content_hash, raw_content, fetched_at)
       VALUES ($1, $2, $2, 'text/plain', 200, $3, $4, now())
       RETURNING id`,
      [sourceId, url, contentHash, rawContent]
    );

    const observation = await pool.query<{ id: string }>(
      `INSERT INTO phone_observations
         (raw_document_id, phone_raw, phone_normalized, context_text, extraction_method, confidence, position_start, position_end)
       VALUES ($1, $2, $3, $4, 'user_confirmed_manual', 1.0, 0, $5)
       RETURNING id`,
      [rawDoc.rows[0].id, entry.phoneRaw, normalized.normalized, entry.displayName, entry.phoneRaw.length]
    );

    const phoneNumberRow = await pool.query<{ id: string }>(
      `INSERT INTO phone_numbers (phone_e164, country_code, national_number, phone_type, observation_count)
       VALUES ($1, '84', $2, $3, 1)
       ON CONFLICT (phone_e164) DO UPDATE SET
         observation_count = phone_numbers.observation_count + 1,
         last_seen_at = now(),
         updated_at = now()
       RETURNING id`,
      [normalized.normalized, normalized.normalized.replace(/^\+84/, "0"), normalized.type]
    );

    const normalizedName = entry.displayName.toLowerCase().trim().replace(/\s+/g, " ");
    const identityRow = await pool.query<{ id: string }>(
      `INSERT INTO phone_identities
         (phone_number_id, display_name, normalized_name, identity_type, category, claim_source, confidence, evidence_count, status, last_seen_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'user_confirmed_v1', 95, 1, 'CONFIRMED', now(), now())
       ON CONFLICT (phone_number_id, normalized_name, claim_source) DO UPDATE SET
         category = EXCLUDED.category,
         last_seen_at = now(),
         updated_at = now()
       RETURNING id`,
      [phoneNumberRow.rows[0].id, entry.displayName, normalizedName, entry.identityType ?? "UNKNOWN", entry.category ?? null]
    );

    await pool.query(
      `INSERT INTO phone_identity_evidence (phone_identity_id, phone_observation_id, evidence_weight)
       VALUES ($1, $2, 1)
       ON CONFLICT (phone_identity_id, phone_observation_id) DO NOTHING`,
      [identityRow.rows[0].id, observation.rows[0].id]
    );

    // evidence_count reflects actual linked rows, not a blind increment --
    // safe to call repeatedly (e.g. re-submitting the same screenshot).
    await pool.query(
      `UPDATE phone_identities SET evidence_count = (
         SELECT count(*) FROM phone_identity_evidence WHERE phone_identity_id = $1
       ) WHERE id = $1`,
      [identityRow.rows[0].id]
    );

    results.push({
      phoneRaw: entry.phoneRaw,
      phoneNormalized: normalized.normalized,
      valid: true,
      identityId: identityRow.rows[0].id,
    });
  }

  return results;
}
