import { sql, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  phoneObservations,
  rawDocuments,
  dataSources,
  phoneNumbers,
  phoneIdentities,
  phoneIdentityEvidence,
} from "../db/schema.js";
import type { IdentityCategory, IdentityType } from "@phoneintel/shared-types";

interface ObservationRow {
  observationId: string;
  phoneNormalized: string;
  contextText: string;
  contextBefore: string;
  contextAfter: string;
  sourceId: string;
  sourceName: string;
  sourceType: string;
  trustLevel: string;
}

interface IdentityCandidate {
  displayName: string;
  normalizedName: string;
  identityType: IdentityType;
  category: IdentityCategory | null;
  observationIds: string[];
  sourceIsOfficial: boolean;
  sourceTrustHigh: boolean;
  hasHotlineKeyword: boolean;
  hasCongTyKeyword: boolean;
}

const COMPANY_NAME_REGEX = /(Công ty|Cty|Doanh nghiệp)[^.,:;\n]{2,60}/i;

const CATEGORY_KEYWORDS: Array<[RegExp, IdentityCategory]> = [
  [/ngân hàng|bank/i, "BANK"],
  [/bảo hiểm|insurance/i, "INSURANCE"],
  [/viễn thông|telecom|mobifone|vinaphone|viettel/i, "TELECOM"],
  [/bệnh viện|phòng khám|hospital|clinic/i, "HOSPITAL"],
  [/uỷ ban|ủy ban|sở |bộ |chính phủ|government/i, "GOVERNMENT"],
  [/giao hàng|ship|delivery|vận chuyển/i, "DELIVERY"],
  [/thương mại điện tử|ecommerce|sàn tmđt/i, "ECOMMERCE"],
  [/bất động sản|real estate|chung cư|căn hộ/i, "REAL_ESTATE"],
  [/telesale|tư vấn viên|quảng cáo|marketing/i, "TELEMARKETING"],
  [/lừa đảo|scam|chiếm đoạt/i, "SCAM"],
  [/spam|làm phiền|rác/i, "SPAM"],
];

function normalizeNameKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

function guessIdentity(
  contextText: string,
  contextBefore: string,
  contextAfter: string,
  sourceName: string
): { displayName: string; identityType: IdentityType; category: IdentityCategory | null } {
  const hasHotline = /hotline|tổng đài|đường dây nóng/i.test(contextText);
  // Search only the surrounding text, not contextText (which embeds the
  // phone digits themselves) — otherwise a name match can run straight
  // into the phone number, e.g. "Công ty ABC - 0912345678".
  const companyMatch = `${contextBefore} ${contextAfter}`.match(COMPANY_NAME_REGEX);

  let category: IdentityCategory | null = null;
  for (const [regex, cat] of CATEGORY_KEYWORDS) {
    if (regex.test(contextText)) {
      category = cat;
      break;
    }
  }

  if (companyMatch) {
    // Trim trailing connector junk left over when the match runs right up
    // to the phone number, e.g. "Công ty XYZ Bảo hiểm - đt" -> "Công ty XYZ Bảo hiểm".
    // Note: no \b here — JS's default (non-unicode) \b treats Vietnamese
    // diacritics as non-word chars, so it silently fails to bound on them.
    const cleaned = companyMatch[0].replace(/[\s\-:]+(đt|sđt|hotline|tel|liên hệ)?\s*$/i, "").trim();
    return { displayName: cleaned || companyMatch[0].trim(), identityType: "BUSINESS", category };
  }
  if (hasHotline) {
    return { displayName: `${sourceName} Hotline`, identityType: "HOTLINE", category };
  }
  return { displayName: `Unknown (${sourceName})`, identityType: "UNKNOWN", category };
}

function computeScore(candidate: IdentityCandidate): number {
  let score = 0;
  if (candidate.sourceTrustHigh) score += 20;
  score += 10 * candidate.observationIds.length;
  if (candidate.hasHotlineKeyword) score += 15;
  if (candidate.hasCongTyKeyword) score += 15;
  if (candidate.sourceIsOfficial) score += 20;
  return Math.min(score, 100);
}

export interface AggregationResult {
  phonesProcessed: number;
  identitiesUpserted: number;
  evidenceLinksCreated: number;
}

export async function runAggregation(): Promise<AggregationResult> {
  const rows = await db
    .select({
      observationId: phoneObservations.id,
      phoneNormalized: phoneObservations.phoneNormalized,
      contextText: phoneObservations.contextText,
      contextBefore: phoneObservations.contextBefore,
      contextAfter: phoneObservations.contextAfter,
      sourceId: dataSources.id,
      sourceName: dataSources.name,
      sourceType: dataSources.sourceType,
      trustLevel: dataSources.trustLevel,
    })
    .from(phoneObservations)
    .innerJoin(rawDocuments, eq(phoneObservations.rawDocumentId, rawDocuments.id))
    .innerJoin(dataSources, eq(rawDocuments.sourceId, dataSources.id))
    .where(isNotNull(phoneObservations.phoneNormalized));

  const byPhone = new Map<string, ObservationRow[]>();
  for (const row of rows) {
    if (!row.phoneNormalized) continue;
    const list = byPhone.get(row.phoneNormalized) ?? [];
    list.push(row as ObservationRow);
    byPhone.set(row.phoneNormalized, list);
  }

  let identitiesUpserted = 0;
  let evidenceLinksCreated = 0;

  for (const [phoneE164, observations] of byPhone) {
    const [phoneNumberRow] = await db
      .select({ id: phoneNumbers.id })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.phoneE164, phoneE164))
      .limit(1);
    if (!phoneNumberRow) continue; // normalization layer hasn't upserted this phone yet

    const candidatesByKey = new Map<string, IdentityCandidate>();
    for (const obs of observations) {
      const guess = guessIdentity(obs.contextText, obs.contextBefore, obs.contextAfter, obs.sourceName);
      const key = normalizeNameKey(guess.displayName);
      const existing = candidatesByKey.get(key);
      const isOfficial = obs.sourceType === "OFFICIAL_WEBSITE" || obs.sourceType === "GOVERNMENT";
      const isHigh = obs.trustLevel === "HIGH";
      const hasHotline = /hotline|tổng đài|đường dây nóng/i.test(obs.contextText);
      const hasCongTy = /công ty|cty|doanh nghiệp/i.test(obs.contextText);

      if (existing) {
        existing.observationIds.push(obs.observationId);
        existing.sourceIsOfficial = existing.sourceIsOfficial || isOfficial;
        existing.sourceTrustHigh = existing.sourceTrustHigh || isHigh;
        existing.hasHotlineKeyword = existing.hasHotlineKeyword || hasHotline;
        existing.hasCongTyKeyword = existing.hasCongTyKeyword || hasCongTy;
      } else {
        candidatesByKey.set(key, {
          displayName: guess.displayName,
          normalizedName: key,
          identityType: guess.identityType,
          category: guess.category,
          observationIds: [obs.observationId],
          sourceIsOfficial: isOfficial,
          sourceTrustHigh: isHigh,
          hasHotlineKeyword: hasHotline,
          hasCongTyKeyword: hasCongTy,
        });
      }
    }

    for (const candidate of candidatesByKey.values()) {
      const confidence = computeScore(candidate);
      const now = new Date();

      const [identityRow] = await db
        .insert(phoneIdentities)
        .values({
          phoneNumberId: phoneNumberRow.id,
          displayName: candidate.displayName,
          normalizedName: candidate.normalizedName,
          identityType: candidate.identityType,
          category: candidate.category ?? undefined,
          claimSource: "rule_based_aggregation_v1",
          confidence: String(confidence),
          evidenceCount: candidate.observationIds.length,
          lastSeenAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [phoneIdentities.phoneNumberId, phoneIdentities.normalizedName, phoneIdentities.claimSource],
          set: {
            evidenceCount: candidate.observationIds.length,
            confidence: String(confidence),
            category: candidate.category ?? undefined,
            lastSeenAt: now,
            updatedAt: now,
          },
        })
        .returning({ id: phoneIdentities.id });

      identitiesUpserted += 1;

      for (const observationId of candidate.observationIds) {
        const inserted = await db
          .insert(phoneIdentityEvidence)
          .values({
            phoneIdentityId: identityRow.id,
            phoneObservationId: observationId,
            evidenceWeight: "1",
          })
          .onConflictDoNothing()
          .returning({ id: phoneIdentityEvidence.id });
        if (inserted.length > 0) evidenceLinksCreated += 1;
      }
    }
  }

  return { phonesProcessed: byPhone.size, identitiesUpserted, evidenceLinksCreated };
}
