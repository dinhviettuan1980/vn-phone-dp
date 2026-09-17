import { pool } from "../db/client.js";
import { normalizeVietnamPhone } from "../normalizers/vietnamPhone.js";

export interface SuppressionEntry {
  phoneNormalized: string;
  reason: string | null;
  createdAt: string;
}

export interface SuppressionResult {
  phoneNormalized: string | null;
  valid: boolean;
}

export async function suppressNumber(phoneRaw: string, reason?: string): Promise<SuppressionResult> {
  const normalized = normalizeVietnamPhone(phoneRaw);
  if (!normalized.normalized) return { phoneNormalized: null, valid: false };

  await pool.query(
    `INSERT INTO label_suppressions (phone_normalized, reason) VALUES ($1, $2)
     ON CONFLICT (phone_normalized) DO UPDATE SET reason = EXCLUDED.reason`,
    [normalized.normalized, reason ?? null]
  );
  return { phoneNormalized: normalized.normalized, valid: true };
}

export async function unsuppressNumber(phoneRaw: string): Promise<SuppressionResult> {
  const normalized = normalizeVietnamPhone(phoneRaw);
  if (!normalized.normalized) return { phoneNormalized: null, valid: false };

  await pool.query(`DELETE FROM label_suppressions WHERE phone_normalized = $1`, [normalized.normalized]);
  return { phoneNormalized: normalized.normalized, valid: true };
}

export async function isSuppressed(phoneNormalized: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM label_suppressions WHERE phone_normalized = $1`, [phoneNormalized]);
  return result.rows.length > 0;
}

export async function listSuppressions(): Promise<SuppressionEntry[]> {
  const result = await pool.query<{ phone_normalized: string; reason: string | null; created_at: string }>(
    `SELECT phone_normalized, reason, created_at FROM label_suppressions ORDER BY created_at DESC`
  );
  return result.rows.map((r) => ({ phoneNormalized: r.phone_normalized, reason: r.reason, createdAt: r.created_at }));
}

/** Used by services/callDirectoryExport.ts to drop suppressed numbers from
 * the export -- a suppressed number gets no label at all, appearing exactly
 * like an unknown call, without deleting its underlying identity/report data. */
export async function getSuppressedSet(): Promise<Set<string>> {
  const result = await pool.query<{ phone_normalized: string }>(`SELECT phone_normalized FROM label_suppressions`);
  return new Set(result.rows.map((r) => r.phone_normalized));
}
