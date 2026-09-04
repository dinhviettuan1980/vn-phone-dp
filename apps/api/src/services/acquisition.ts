import { pool } from "../db/client.js";

export interface AcquisitionJob {
  id: string;
  jobType: string;
  sourceId: string | null;
  sourceName: string | null;
  crawlTargetId: string | null;
  priority: number;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export async function listJobs(status?: string, jobType?: string, limit = 50): Promise<AcquisitionJob[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) {
    params.push(status);
    conditions.push(`cj.status = $${params.length}`);
  }
  if (jobType) {
    params.push(jobType);
    conditions.push(`cj.job_type = $${params.length}`);
  }
  params.push(limit);

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(
    `
    SELECT cj.id, cj.job_type, cj.source_id, ds.name AS source_name, cj.crawl_target_id,
           cj.priority, cj.status, cj.attempt_count, cj.max_attempts, cj.scheduled_at,
           cj.started_at, cj.finished_at, cj.error_message, cj.metadata, cj.created_at
    FROM crawl_jobs cj
    LEFT JOIN data_sources ds ON ds.id = cj.source_id
    ${where}
    ORDER BY cj.created_at DESC
    LIMIT $${params.length}
    `,
    params
  );
  return result.rows.map(mapJobRow);
}

export async function getJob(id: string): Promise<AcquisitionJob | null> {
  const result = await pool.query(
    `
    SELECT cj.id, cj.job_type, cj.source_id, ds.name AS source_name, cj.crawl_target_id,
           cj.priority, cj.status, cj.attempt_count, cj.max_attempts, cj.scheduled_at,
           cj.started_at, cj.finished_at, cj.error_message, cj.metadata, cj.created_at
    FROM crawl_jobs cj
    LEFT JOIN data_sources ds ON ds.id = cj.source_id
    WHERE cj.id = $1
    `,
    [id]
  );
  return result.rows[0] ? mapJobRow(result.rows[0]) : null;
}

/** Enqueues a DISCOVER_DOMAIN job -- the worker (Python, jobs/worker.py)
 * picks it up and runs domain_discovery. Cross-language job handoff via
 * the shared crawl_jobs table, not a direct RPC. */
export async function enqueueDomainDiscovery(domain: string, sourceName?: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO crawl_jobs (job_type, priority, metadata) VALUES ('DISCOVER_DOMAIN', 150, $1) RETURNING id`,
    [JSON.stringify({ domain, source_name: sourceName })]
  );
  return result.rows[0].id;
}

function mapJobRow(row: any): AcquisitionJob {
  return {
    id: row.id,
    jobType: row.job_type,
    sourceId: row.source_id,
    sourceName: row.source_name,
    crawlTargetId: row.crawl_target_id,
    priority: row.priority,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

export async function getAcquisitionStats() {
  const [crawling, discovery, data, quality] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT count(*) FROM data_sources) AS total_sources,
        (SELECT count(*) FROM data_sources WHERE is_active) AS active_sources,
        (SELECT count(*) FROM crawl_targets) AS total_crawl_targets,
        (SELECT count(*) FROM crawl_targets WHERE crawl_status = 'PENDING') AS pending_targets,
        (SELECT count(*) FROM crawl_jobs WHERE job_type IN ('CRAWL_URL','CRAWL_SOURCE','RECRAWL') AND status = 'SUCCESS') AS successful_crawls,
        (SELECT count(*) FROM crawl_jobs WHERE job_type IN ('CRAWL_URL','CRAWL_SOURCE','RECRAWL') AND status = 'FAILED') AS failed_crawls,
        (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000), 0) FROM crawl_jobs WHERE finished_at IS NOT NULL AND started_at IS NOT NULL) AS average_crawl_duration_ms
    `),
    pool.query(`
      SELECT
        count(DISTINCT domain) AS domains_discovered,
        COALESCE(SUM(sitemaps_found), 0) AS sitemaps_discovered,
        COALESCE(SUM(urls_discovered), 0) AS urls_discovered,
        COALESCE(SUM(urls_high_priority), 0) AS urls_high_priority,
        COALESCE(SUM(urls_queued), 0) AS urls_queued
      FROM domain_discoveries
    `),
    pool.query(`
      SELECT
        (SELECT count(*) FROM raw_documents) AS raw_documents,
        (SELECT count(*) FROM phone_observations) AS phone_observations,
        (SELECT count(*) FROM phone_numbers) AS unique_phone_numbers
    `),
    pool.query(`
      SELECT
        CASE WHEN (SELECT count(*) FROM raw_documents) = 0 THEN 0
          ELSE 1.0 - (SELECT count(DISTINCT content_hash)::float FROM raw_documents) / (SELECT count(*)::float FROM raw_documents)
        END AS duplicate_content_ratio,
        CASE WHEN (SELECT count(*) FROM phone_observations) = 0 THEN 0
          ELSE (SELECT count(*)::float FROM phone_observations WHERE phone_normalized IS NULL) / (SELECT count(*)::float FROM phone_observations)
        END AS invalid_phone_ratio,
        CASE WHEN (SELECT count(*) FROM phone_observations) = 0 THEN 0
          ELSE (SELECT count(*)::float FROM phone_observations WHERE phone_normalized IS NOT NULL) / (SELECT count(*)::float FROM phone_observations)
        END AS normalization_success_rate
    `),
  ]);

  const c = crawling.rows[0];
  const d = discovery.rows[0];
  const dat = data.rows[0];
  const q = quality.rows[0];

  const phonesPerDocument = Number(dat.raw_documents) > 0 ? Number(dat.phone_observations) / Number(dat.raw_documents) : 0;

  return {
    crawling: {
      total_sources: Number(c.total_sources),
      active_sources: Number(c.active_sources),
      total_crawl_targets: Number(c.total_crawl_targets),
      pending_targets: Number(c.pending_targets),
      successful_crawls: Number(c.successful_crawls),
      failed_crawls: Number(c.failed_crawls),
      average_crawl_duration_ms: Math.round(Number(c.average_crawl_duration_ms)),
    },
    discovery: {
      domains_discovered: Number(d.domains_discovered),
      sitemaps_discovered: Number(d.sitemaps_discovered),
      urls_discovered: Number(d.urls_discovered),
      urls_high_priority: Number(d.urls_high_priority),
      urls_queued: Number(d.urls_queued),
    },
    data: {
      raw_documents: Number(dat.raw_documents),
      phone_observations: Number(dat.phone_observations),
      unique_phone_numbers: Number(dat.unique_phone_numbers),
      phones_per_document: Number(phonesPerDocument.toFixed(2)),
    },
    quality: {
      duplicate_content_ratio: Number(Number(q.duplicate_content_ratio).toFixed(4)),
      invalid_phone_ratio: Number(Number(q.invalid_phone_ratio).toFixed(4)),
      normalization_success_rate: Number(Number(q.normalization_success_rate).toFixed(4)),
    },
  };
}

export async function getSourcePerformance(sourceId: string) {
  const result = await pool.query(
    `
    SELECT
      ds.id, ds.name, ds.trust_level,
      count(DISTINCT rd.id) AS urls_crawled,
      count(po.id) AS phone_observations,
      count(DISTINCT po.phone_normalized) FILTER (WHERE po.phone_normalized IS NOT NULL) AS unique_phones
    FROM data_sources ds
    LEFT JOIN raw_documents rd ON rd.source_id = ds.id
    LEFT JOIN phone_observations po ON po.raw_document_id = rd.id
    WHERE ds.id = $1
    GROUP BY ds.id, ds.name, ds.trust_level
    `,
    [sourceId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const urlsCrawled = Number(row.urls_crawled);
  const phoneObservations = Number(row.phone_observations);
  const yieldPerPage = urlsCrawled > 0 ? phoneObservations / urlsCrawled : 0;

  return {
    source_id: row.id,
    source_name: row.name,
    trust_level: row.trust_level,
    urls_crawled: urlsCrawled,
    phone_observations: phoneObservations,
    unique_phones: Number(row.unique_phones),
    yield_per_page: Number(yieldPerPage.toFixed(2)),
  };
}
