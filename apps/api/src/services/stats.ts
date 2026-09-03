import { sql, eq } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { dataSources, rawDocuments, phoneObservations, phoneNumbers } from "../db/schema.js";

export async function getDataQualityStats() {
  const [{ count: totalRawDocuments }] = await db.select({ count: sql<number>`count(*)` }).from(rawDocuments);
  const [{ count: totalObservations }] = await db.select({ count: sql<number>`count(*)` }).from(phoneObservations);
  const [{ count: totalUniquePhones }] = await db.select({ count: sql<number>`count(*)` }).from(phoneNumbers);
  const [{ count: validPhones }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(phoneNumbers)
    .where(sql`${phoneNumbers.phoneType} != 'UNKNOWN'`);
  const [{ count: invalidCandidates }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(phoneObservations)
    .where(sql`${phoneObservations.phoneNormalized} IS NULL`);
  const [{ count: multiEvidencePhones }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(phoneNumbers)
    .where(sql`${phoneNumbers.observationCount} > 3`);

  const dupContentResult = await pool.query<{ ratio: number }>(`
    SELECT
      CASE WHEN count(*) = 0 THEN 0
      ELSE 1.0 - (count(DISTINCT content_hash)::float / count(*)::float)
      END AS ratio
    FROM raw_documents
  `);

  const topSources = await pool.query<{ name: string; phone_count: number }>(`
    SELECT ds.name, count(po.id) AS phone_count
    FROM phone_observations po
    JOIN raw_documents rd ON rd.id = po.raw_document_id
    JOIN data_sources ds ON ds.id = rd.source_id
    GROUP BY ds.name
    ORDER BY phone_count DESC
    LIMIT 5
  `);

  return {
    total_raw_documents: Number(totalRawDocuments),
    total_observations: Number(totalObservations),
    total_unique_phone_numbers: Number(totalUniquePhones),
    valid_phones: Number(validPhones),
    invalid_phone_candidates: Number(invalidCandidates),
    phones_with_multiple_evidence: Number(multiEvidencePhones),
    duplicate_content_ratio: Number(dupContentResult.rows[0]?.ratio ?? 0),
    top_sources_by_phone_count: topSources.rows.map((r) => ({ name: r.name, phone_count: Number(r.phone_count) })),
  };
}

export async function getSourceStats() {
  const rows = await pool.query<{
    id: string;
    name: string;
    source_type: string;
    trust_level: string;
    raw_documents: number;
    observations: number;
  }>(`
    SELECT
      ds.id, ds.name, ds.source_type, ds.trust_level,
      count(DISTINCT rd.id) AS raw_documents,
      count(po.id) AS observations
    FROM data_sources ds
    LEFT JOIN raw_documents rd ON rd.source_id = ds.id
    LEFT JOIN phone_observations po ON po.raw_document_id = rd.id
    GROUP BY ds.id, ds.name, ds.source_type, ds.trust_level
    ORDER BY ds.name
  `);
  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    source_type: r.source_type,
    trust_level: r.trust_level,
    raw_documents: Number(r.raw_documents),
    observations: Number(r.observations),
  }));
}
