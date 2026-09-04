import { pool } from "../db/client.js";
import { normalizeVietnamPhone } from "../normalizers/vietnamPhone.js";

export interface CallLogImportEntry {
  phoneRaw: string;
  callCount?: number;
}

export interface CallLogImportResult {
  phoneRaw: string;
  phoneNormalized: string | null;
  valid: boolean;
  known: boolean;
  identityName: string | null;
}

/**
 * Manually reported call log (iOS gives third-party apps no API to read
 * call history -- see README.md). One row per (phone, date) batch; the
 * caller resubmitting the same phone+date just adds another row, which is
 * fine since we only ever SUM call_count, never assume uniqueness.
 */
export async function importCallLogEntries(
  callDate: string,
  entries: CallLogImportEntry[],
  notes?: string
): Promise<CallLogImportResult[]> {
  const results: CallLogImportResult[] = [];

  for (const entry of entries) {
    const normalized = normalizeVietnamPhone(entry.phoneRaw);
    const callCount = entry.callCount && entry.callCount > 0 ? entry.callCount : 1;

    await pool.query(
      `INSERT INTO personal_call_logs (phone_raw, phone_normalized, call_date, call_count, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.phoneRaw, normalized.normalized, callDate, callCount, notes ?? null]
    );

    let identityName: string | null = null;
    if (normalized.normalized) {
      const identityResult = await pool.query<{ display_name: string }>(
        `SELECT pi.display_name
         FROM phone_identities pi
         JOIN phone_numbers pn ON pn.id = pi.phone_number_id
         WHERE pn.phone_e164 = $1 AND pi.status != 'REJECTED'
         ORDER BY pi.confidence DESC
         LIMIT 1`,
        [normalized.normalized]
      );
      identityName = identityResult.rows[0]?.display_name ?? null;
    }

    results.push({
      phoneRaw: entry.phoneRaw,
      phoneNormalized: normalized.normalized,
      valid: normalized.valid,
      known: identityName !== null,
      identityName,
    });
  }

  return results;
}

export interface CallLogSummaryRow {
  phoneRaw: string;
  phoneNormalized: string | null;
  totalCalls: number;
  daysCalled: number;
  firstCallDate: string;
  lastCallDate: string;
  known: boolean;
  identityName: string | null;
  identityCategory: string | null;
}

export async function getCallLogSummary(from: string, to: string): Promise<CallLogSummaryRow[]> {
  const result = await pool.query<{
    phone_raw: string;
    phone_normalized: string | null;
    total_calls: string;
    days_called: string;
    first_call_date: string;
    last_call_date: string;
    display_name: string | null;
    category: string | null;
  }>(
    `
    WITH grouped AS (
      SELECT
        COALESCE(phone_normalized, phone_raw) AS group_key,
        (array_agg(phone_raw ORDER BY imported_at DESC))[1] AS phone_raw,
        phone_normalized,
        SUM(call_count) AS total_calls,
        COUNT(DISTINCT call_date) AS days_called,
        MIN(call_date) AS first_call_date,
        MAX(call_date) AS last_call_date
      FROM personal_call_logs
      WHERE call_date BETWEEN $1 AND $2
      GROUP BY COALESCE(phone_normalized, phone_raw), phone_normalized
    )
    SELECT
      g.phone_raw, g.phone_normalized, g.total_calls, g.days_called,
      g.first_call_date, g.last_call_date,
      pi.display_name, pi.category
    FROM grouped g
    LEFT JOIN LATERAL (
      SELECT pi.display_name, pi.category
      FROM phone_identities pi
      JOIN phone_numbers pn ON pn.id = pi.phone_number_id
      WHERE pn.phone_e164 = g.phone_normalized AND pi.status != 'REJECTED'
      ORDER BY pi.confidence DESC
      LIMIT 1
    ) pi ON true
    ORDER BY g.total_calls DESC
    `,
    [from, to]
  );

  return result.rows.map((r) => ({
    phoneRaw: r.phone_raw,
    phoneNormalized: r.phone_normalized,
    totalCalls: Number(r.total_calls),
    daysCalled: Number(r.days_called),
    firstCallDate: r.first_call_date,
    lastCallDate: r.last_call_date,
    known: r.display_name !== null,
    identityName: r.display_name,
    identityCategory: r.category,
  }));
}

export interface UnknownNumberRow {
  phoneRaw: string;
  phoneNormalized: string | null;
  totalCalls: number;
  daysCalled: number;
  lastCallDate: string;
}

/** Numbers reported in call logs that have no known identity anywhere in
 * the DB -- the "cần tìm hiểu" (needs research) list. */
export async function getUnknownNumbers(): Promise<UnknownNumberRow[]> {
  const result = await pool.query<{
    phone_raw: string;
    phone_normalized: string | null;
    total_calls: string;
    days_called: string;
    last_call_date: string;
  }>(
    `
    SELECT
      (array_agg(phone_raw ORDER BY imported_at DESC))[1] AS phone_raw,
      phone_normalized,
      SUM(call_count) AS total_calls,
      COUNT(DISTINCT call_date) AS days_called,
      MAX(call_date) AS last_call_date
    FROM personal_call_logs pcl
    WHERE NOT EXISTS (
      SELECT 1 FROM phone_identities pi
      JOIN phone_numbers pn ON pn.id = pi.phone_number_id
      WHERE pn.phone_e164 = pcl.phone_normalized AND pi.status != 'REJECTED'
    )
    GROUP BY COALESCE(phone_normalized, phone_raw), phone_normalized
    ORDER BY total_calls DESC
    `
  );

  return result.rows.map((r) => ({
    phoneRaw: r.phone_raw,
    phoneNormalized: r.phone_normalized,
    totalCalls: Number(r.total_calls),
    daysCalled: Number(r.days_called),
    lastCallDate: r.last_call_date,
  }));
}
