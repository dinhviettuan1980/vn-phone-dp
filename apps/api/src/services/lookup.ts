import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { phoneNumbers, phoneIdentities, phoneObservations, rawDocuments } from "../db/schema.js";
import { normalizeVietnamPhone } from "../normalizers/vietnamPhone.js";
import { getSpamSummary } from "./spamReports.js";
import type { PhoneLookupResponse } from "@phoneintel/shared-types";

const NO_SPAM_REPORTS = { report_count: 0, distinct_reporters: 0, risk_level: "NONE" as const, top_category: null };

export async function lookupPhone(rawInput: string): Promise<PhoneLookupResponse> {
  const normalized = normalizeVietnamPhone(rawInput);

  if (!normalized.normalized) {
    return {
      phone: { raw_input: rawInput, normalized: null, type: normalized.type, valid: false },
      statistics: { observation_count: 0, source_count: 0, first_seen_at: null, last_seen_at: null },
      identities: [],
      spam: NO_SPAM_REPORTS,
    };
  }

  const spamSummary = await getSpamSummary(normalized.normalized);
  const spam = {
    report_count: spamSummary.reportCount,
    distinct_reporters: spamSummary.distinctReporters,
    risk_level: spamSummary.riskLevel,
    top_category: spamSummary.topCategory,
  };

  const [phoneRow] = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.phoneE164, normalized.normalized))
    .limit(1);

  if (!phoneRow) {
    return {
      phone: { raw_input: rawInput, normalized: normalized.normalized, type: normalized.type, valid: normalized.valid },
      statistics: { observation_count: 0, source_count: 0, first_seen_at: null, last_seen_at: null },
      identities: [],
      spam,
    };
  }

  const [sourceCountRow] = await db
    .select({ count: sql<number>`count(distinct ${rawDocuments.sourceId})` })
    .from(phoneObservations)
    .innerJoin(rawDocuments, eq(phoneObservations.rawDocumentId, rawDocuments.id))
    .where(eq(phoneObservations.phoneNormalized, normalized.normalized));

  const identities = await db
    .select()
    .from(phoneIdentities)
    .where(eq(phoneIdentities.phoneNumberId, phoneRow.id))
    .orderBy(sql`${phoneIdentities.confidence} desc`);

  return {
    phone: {
      raw_input: rawInput,
      normalized: phoneRow.phoneE164,
      type: phoneRow.phoneType,
      valid: normalized.valid,
    },
    statistics: {
      observation_count: phoneRow.observationCount,
      source_count: Number(sourceCountRow?.count ?? 0),
      first_seen_at: phoneRow.firstSeenAt.toISOString(),
      last_seen_at: phoneRow.lastSeenAt.toISOString(),
    },
    identities: identities.map((i) => ({
      name: i.displayName,
      type: i.identityType,
      category: i.category,
      confidence: Number(i.confidence),
      evidence_count: i.evidenceCount,
      status: i.status,
    })),
    spam,
  };
}

export async function searchPhones(query: string, limit = 20) {
  const like = `%${query.replace(/\D/g, "")}%`;
  return db
    .select({
      phoneE164: phoneNumbers.phoneE164,
      phoneType: phoneNumbers.phoneType,
      observationCount: phoneNumbers.observationCount,
    })
    .from(phoneNumbers)
    .where(sql`${phoneNumbers.nationalNumber} LIKE ${like}`)
    .limit(limit);
}
