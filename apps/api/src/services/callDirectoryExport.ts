import { pool } from "../db/client.js";
import { normalizeVietnamPhone } from "../normalizers/vietnamPhone.js";
import { getSuppressedSet } from "./labelSuppressions.js";
import { isAutoBlockHighRiskEnabled } from "./appSettings.js";

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

interface SpamFlag {
  distinctReporters: number;
  topCategory: string;
}

/**
 * Numbers with at least one spam/scam report -- surfaced directly on the
 * native call screen, the Truecaller-defining feature of warning about a
 * number BEFORE the identity pipeline has any crawled evidence for it.
 * Threshold (>=1 distinct reporter) matches computeRiskLevel's MEDIUM cutoff
 * in services/spamReports.ts: a single report already matters here (see
 * computeRiskLevel's doc comment) since crawled institutional numbers are
 * the low-value case and a real caller-reported spam number is the whole
 * point of this feature. Only the HIGH tier (>=10 reporters, see
 * getBlockedDigits below) is still gated on genuine volume, because
 * auto-blocking is a much stronger action than a warning label.
 */
async function getSpamFlags(): Promise<Map<string, SpamFlag>> {
  const result = await pool.query<{
    phone_normalized: string;
    distinct_reporters: string;
    category: string;
    category_count: string;
  }>(`
    WITH filtered AS (
      SELECT phone_normalized, category, COALESCE(reporter_ref, id::text) AS reporter_key
      FROM spam_reports
      WHERE phone_normalized IS NOT NULL
    ),
    totals AS (
      SELECT phone_normalized, count(DISTINCT reporter_key) AS distinct_reporters
      FROM filtered
      GROUP BY phone_normalized
      HAVING count(DISTINCT reporter_key) >= 1
    ),
    by_category AS (
      SELECT phone_normalized, category, count(*) AS category_count
      FROM filtered
      WHERE phone_normalized IN (SELECT phone_normalized FROM totals)
      GROUP BY phone_normalized, category
    )
    SELECT t.phone_normalized, t.distinct_reporters, bc.category, bc.category_count
    FROM totals t
    JOIN by_category bc ON bc.phone_normalized = t.phone_normalized
  `);

  const flags = new Map<string, { distinctReporters: number; topCategory: string; topCount: number }>();
  for (const row of result.rows) {
    const count = Number(row.category_count);
    const existing = flags.get(row.phone_normalized);
    if (!existing || count > existing.topCount) {
      flags.set(row.phone_normalized, {
        distinctReporters: Number(row.distinct_reporters),
        topCategory: row.category,
        topCount: count,
      });
    }
  }
  return new Map([...flags].map(([phone, v]) => [phone, { distinctReporters: v.distinctReporters, topCategory: v.topCategory }]));
}

function spamLabel(flag: SpamFlag): string {
  const kind = flag.topCategory === "SCAM" ? "LỪA ĐẢO" : "SPAM";
  return `⚠️ Nghi ngờ ${kind} (${flag.distinctReporters} báo cáo)`;
}

/**
 * Entries for the iOS Call Directory Extension: only MOBILE/LANDLINE numbers
 * (the types that actually appear as an incoming caller ID -- 1900/1800
 * hotlines are numbers customers call TO, not numbers that call customers),
 * backed by at least one HIGH-trust source, highest-confidence identity per
 * phone, sorted ascending by numeric phone value (Apple requires ascending
 * order for a full reload).
 *
 * trust_level = 'HIGH' (not a source-name pattern like 'Fixture%') is the
 * real gate here: Phase 2 domain discovery and dataset ingestion both
 * create sources at trust_level 'MEDIUM' until a human reviews them (see
 * discovery_service.py / dataset_service.py), so anything auto-discovered
 * never reaches a real device's caller ID without that review, regardless
 * of what the source happens to be named.
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
          AND ds.trust_level = 'HIGH'
          AND ds.name NOT LIKE 'Fixture%'
      )
    ORDER BY pn.phone_e164, pi.confidence DESC
  `);

  const spamFlags = await getSpamFlags();
  const seenPhones = new Set<string>();

  const entries: CallDirectoryEntry[] = result.rows.map((row) => {
    seenPhones.add(row.phone_e164);
    const flag = spamFlags.get(row.phone_e164);
    const label = flag
      ? flag.distinctReporters >= 10
        ? spamLabel(flag) // HIGH: override -- warning outweighs a crawled business name
        : `⚠️ ${bestLabel(row.display_name)}` // MEDIUM: prefix, keep the known name
      : bestLabel(row.display_name);
    return { phoneDigits: row.phone_e164.replace(/^\+/, ""), label };
  });

  // Numbers with no crawled identity at all but enough spam reports to warn
  // about anyway -- Truecaller flags these too, not just known businesses.
  for (const [phoneE164, flag] of spamFlags) {
    if (seenPhones.has(phoneE164)) continue;
    const type = normalizeVietnamPhone(phoneE164).type;
    if (type !== "MOBILE" && type !== "LANDLINE") continue;
    entries.push({ phoneDigits: phoneE164.replace(/^\+/, ""), label: spamLabel(flag) });
  }

  // User-configured silence list (see database/migrations/0007_label_suppressions.sql)
  // -- a suppressed number is dropped entirely so it appears exactly like an
  // unknown call, without touching its underlying identity/report data.
  const suppressed = await getSuppressedSet();
  const visibleEntries = entries.filter((e) => !suppressed.has(`+${e.phoneDigits}`));

  // Apple requires strictly ascending numeric order for a full reload.
  visibleEntries.sort((a, b) => (BigInt(a.phoneDigits) < BigInt(b.phoneDigits) ? -1 : 1));
  return visibleEntries;
}

/**
 * Opt-in (services/appSettings.ts:isAutoBlockHighRiskEnabled, default OFF):
 * full E.164 digits (no "+") of numbers to hand to
 * CXCallDirectoryExtensionContext.addBlockingEntry, not just
 * addIdentificationEntry -- the call never rings at all. Deliberately a
 * narrower bar than the HIGH label override (>=10 distinct reporters
 * already used for identification): also requires SCAM as the top
 * category, since auto-blocking is a much stronger action than a warning
 * label and a telemarketing/spam number the owner might still want to
 * receive (e.g. a delivery courier calling from a burner line) shouldn't
 * be silently dropped the same way a reported scam number should.
 * Suppressed numbers (0007_label_suppressions.sql) are excluded here too --
 * an owner override should win over auto-blocking, not just over labeling.
 */
export async function getBlockedDigits(): Promise<string[]> {
  if (!(await isAutoBlockHighRiskEnabled())) return [];

  const spamFlags = await getSpamFlags();
  const suppressed = await getSuppressedSet();

  const blocked: string[] = [];
  for (const [phoneE164, flag] of spamFlags) {
    if (flag.distinctReporters < 10 || flag.topCategory !== "SCAM") continue;
    if (suppressed.has(phoneE164)) continue;
    const type = normalizeVietnamPhone(phoneE164).type;
    if (type !== "MOBILE" && type !== "LANDLINE") continue;
    blocked.push(phoneE164.replace(/^\+/, ""));
  }

  // Apple requires strictly ascending numeric order for a full reload.
  blocked.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  return blocked;
}
