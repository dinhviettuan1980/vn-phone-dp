import { pool } from "../db/client.js";
import { normalizeVietnamPhone } from "../normalizers/vietnamPhone.js";
import type { SpamReportCategory, SpamRiskLevel } from "@phoneintel/shared-types";

export interface SubmitSpamReportInput {
  phoneRaw: string;
  category?: SpamReportCategory;
  note?: string;
  reporterRef?: string;
}

export interface SubmitSpamReportResult {
  phoneRaw: string;
  phoneNormalized: string | null;
  valid: boolean;
  skippedReason?: string;
  summary?: SpamSummary;
}

export interface SpamSummary {
  reportCount: number;
  distinctReporters: number;
  riskLevel: SpamRiskLevel;
  topCategory: SpamReportCategory | null;
  categoryBreakdown: Record<string, number>;
}

/**
 * Rule-based, same philosophy as the rest of this project's aggregation
 * (docs/architecture.md): no ML. Owner's call (2026-09-22): a crawled
 * institutional number almost never actually spam-calls anyone, so the real
 * signal this app needs is "did anyone at all flag this unknown number" --
 * a single report already matters and should surface immediately, not wait
 * for a crowd. Only HIGH (auto-block eligibility, see
 * services/callDirectoryExport.ts:getBlockedDigits) still requires genuine
 * volume, since blocking is a much stronger action than a warning label.
 * reporter_ref is optional and client-supplied (no accounts exist) --
 * reports with no reporter_ref each count as their own distinct reporter
 * since there's nothing to dedupe them against.
 */
export function computeRiskLevel(distinctReporters: number): SpamRiskLevel {
  if (distinctReporters >= 10) return "HIGH";
  if (distinctReporters >= 1) return "MEDIUM";
  return "NONE";
}

export async function submitSpamReport(input: SubmitSpamReportInput): Promise<SubmitSpamReportResult> {
  const normalized = normalizeVietnamPhone(input.phoneRaw);
  if (!normalized.normalized) {
    return { phoneRaw: input.phoneRaw, phoneNormalized: null, valid: false, skippedReason: "invalid_phone_format" };
  }

  await pool.query(
    `INSERT INTO spam_reports (phone_raw, phone_normalized, category, note, reporter_ref)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.phoneRaw, normalized.normalized, input.category ?? "SPAM", input.note ?? null, input.reporterRef ?? null]
  );

  const summary = await getSpamSummary(normalized.normalized);

  return {
    phoneRaw: input.phoneRaw,
    phoneNormalized: normalized.normalized,
    valid: true,
    summary,
  };
}

export async function getSpamSummary(phoneNormalized: string): Promise<SpamSummary> {
  const result = await pool.query<{
    report_count: string;
    distinct_reporters: string;
    category: string;
    category_count: string;
  }>(
    `
    WITH filtered AS (
      SELECT category, COALESCE(reporter_ref, id::text) AS reporter_key
      FROM spam_reports
      WHERE phone_normalized = $1
    ),
    totals AS (
      SELECT count(*) AS report_count, count(DISTINCT reporter_key) AS distinct_reporters FROM filtered
    ),
    by_category AS (
      SELECT category, count(*) AS category_count FROM filtered GROUP BY category
    )
    SELECT bc.category, bc.category_count, t.report_count, t.distinct_reporters
    FROM by_category bc CROSS JOIN totals t
    `,
    [phoneNormalized]
  );

  if (result.rows.length === 0) {
    return { reportCount: 0, distinctReporters: 0, riskLevel: "NONE", topCategory: null, categoryBreakdown: {} };
  }

  const categoryBreakdown: Record<string, number> = {};
  let topCategory: SpamReportCategory | null = null;
  let topCount = -1;
  for (const row of result.rows) {
    const count = Number(row.category_count);
    categoryBreakdown[row.category] = count;
    if (count > topCount) {
      topCount = count;
      topCategory = row.category as SpamReportCategory;
    }
  }

  const distinctReporters = Number(result.rows[0].distinct_reporters);

  return {
    reportCount: Number(result.rows[0].report_count),
    distinctReporters,
    riskLevel: computeRiskLevel(distinctReporters),
    topCategory,
    categoryBreakdown,
  };
}

export interface RecentSpamReport {
  category: SpamReportCategory;
  note: string | null;
  reportedAt: string;
}

export async function getRecentSpamReports(phoneNormalized: string, limit = 10): Promise<RecentSpamReport[]> {
  const result = await pool.query<{ category: string; note: string | null; reported_at: string }>(
    `SELECT category, note, reported_at FROM spam_reports
     WHERE phone_normalized = $1
     ORDER BY reported_at DESC
     LIMIT $2`,
    [phoneNormalized, limit]
  );
  return result.rows.map((r) => ({
    category: r.category as SpamReportCategory,
    note: r.note,
    reportedAt: r.reported_at,
  }));
}
