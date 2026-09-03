import { pool } from "../db/client.js";

export interface CallDirectoryEntry {
  /** Full E.164 digits, no "+", as required by CXCallDirectoryPhoneNumber (Int64). */
  phoneDigits: string;
  label: string;
}

function bestLabel(displayName: string): string {
  // Aggregation sometimes falls back to "Unknown (SourceName)" when the page
  // had no nearby descriptive text (see docs/architecture.md) -- still
  // informative for caller ID (source name is real), just strip the wrapper.
  const match = displayName.match(/^Unknown \((.+)\)$/);
  return match ? match[1] : displayName;
}

/**
 * Entries for the iOS Call Directory Extension: only MOBILE/LANDLINE numbers
 * (the types that actually appear as an incoming caller ID -- 1900/1800
 * hotlines are numbers customers call TO, not numbers that call customers),
 * backed by at least one real (non-fixture) source, highest-confidence
 * identity per phone, sorted ascending by numeric phone value (Apple
 * requires ascending order for a full reload).
 */
export async function getCallDirectoryEntries(): Promise<CallDirectoryEntry[]> {
  const result = await pool.query<{ phone_e164: string; display_name: string; confidence: string }>(`
    SELECT DISTINCT ON (pn.phone_e164)
      pn.phone_e164,
      pi.display_name,
      pi.confidence
    FROM phone_numbers pn
    JOIN phone_identities pi ON pi.phone_number_id = pn.id AND pi.status != 'REJECTED'
    WHERE pn.phone_type IN ('MOBILE', 'LANDLINE')
      AND EXISTS (
        SELECT 1
        FROM phone_identity_evidence pie
        JOIN phone_observations po ON po.id = pie.phone_observation_id
        JOIN raw_documents rd ON rd.id = po.raw_document_id
        JOIN data_sources ds ON ds.id = rd.source_id
        WHERE pie.phone_identity_id = pi.id
          AND ds.name NOT LIKE 'Fixture%'
      )
    ORDER BY pn.phone_e164, pi.confidence DESC
  `);

  const entries: CallDirectoryEntry[] = result.rows.map((row) => ({
    phoneDigits: row.phone_e164.replace(/^\+/, ""),
    label: bestLabel(row.display_name),
  }));

  // Apple requires strictly ascending numeric order for a full reload.
  entries.sort((a, b) => (BigInt(a.phoneDigits) < BigInt(b.phoneDigits) ? -1 : 1));
  return entries;
}
