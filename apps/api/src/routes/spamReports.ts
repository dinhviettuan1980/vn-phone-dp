import type { FastifyInstance } from "fastify";
import { submitSpamReport, getSpamSummary, getRecentSpamReports } from "../services/spamReports.js";
import { normalizeVietnamPhone } from "../normalizers/vietnamPhone.js";
import type { SpamReportCategory } from "@phoneintel/shared-types";

const VALID_CATEGORIES: SpamReportCategory[] = ["SPAM", "SCAM", "TELEMARKETING", "HARASSMENT", "OTHER"];

interface ReportBody {
  phone_raw: string;
  category?: SpamReportCategory;
  note?: string;
  reporter_ref?: string;
}

export async function spamReportRoutes(app: FastifyInstance) {
  app.post<{ Body: ReportBody }>("/api/v1/spam-reports", async (request, reply) => {
    const { phone_raw, category, note, reporter_ref } = request.body ?? {};

    if (!phone_raw || typeof phone_raw !== "string") {
      return reply.status(400).send({ error: "missing_phone_raw" });
    }
    if (category && !VALID_CATEGORIES.includes(category)) {
      return reply.status(400).send({ error: "invalid_category", allowed: VALID_CATEGORIES });
    }

    const result = await submitSpamReport({ phoneRaw: phone_raw, category, note, reporterRef: reporter_ref });
    if (!result.valid) {
      return reply.status(422).send({ error: result.skippedReason, phone_raw });
    }

    return reply.send({
      phone_raw: result.phoneRaw,
      phone_normalized: result.phoneNormalized,
      report_count: result.summary?.reportCount ?? 0,
      distinct_reporters: result.summary?.distinctReporters ?? 0,
      risk_level: result.summary?.riskLevel ?? "NONE",
    });
  });

  app.get<{ Params: { phone: string } }>("/api/v1/spam-reports/:phone", async (request, reply) => {
    const normalized = normalizeVietnamPhone(request.params.phone);
    if (!normalized.normalized) {
      return reply.status(422).send({ error: "invalid_phone_format", phone_raw: request.params.phone });
    }

    const [summary, recent] = await Promise.all([
      getSpamSummary(normalized.normalized),
      getRecentSpamReports(normalized.normalized),
    ]);

    return reply.send({
      phone_normalized: normalized.normalized,
      report_count: summary.reportCount,
      distinct_reporters: summary.distinctReporters,
      risk_level: summary.riskLevel,
      top_category: summary.topCategory,
      category_breakdown: summary.categoryBreakdown,
      recent_reports: recent,
    });
  });
}
