import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { phoneNumbers, phoneIdentities, phoneObservations, rawDocuments } from "../db/schema.js";
import { normalizeVietnamPhone } from "../normalizers/vietnamPhone.js";
import type { PhoneLookupResponse } from "@phoneintel/shared-types";

export async function lookupPhone(rawInput: string): Promise<PhoneLookupResponse> {
  const normalized = normalizeVietnamPhone(rawInput);

  if (!normalized.normalized) {
    return {
      phone: { raw_input: rawInput, normalized: null, type: normalized.type, valid: false },
      statistics: { observation_count: 0, source_count: 0, first_seen_at: null, last_seen_at: null },
      identities: [],
    };
  }

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
