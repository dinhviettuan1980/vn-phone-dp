import { pool } from "../db/client.js";

/** Same rule as callDirectoryExport.ts::getCallDirectoryEntries -- reused
 * verbatim (not re-derived) so "new phone numbers" and "total production
 * numbers" on the dashboard are guaranteed to match what actually reaches
 * a real device's caller ID. MEDIUM/LOW trust (auto-discovery, dataset
 * ingestion pending review) and REJECTED identities are excluded by this
 * EXISTS clause; see docs/PHASE2_6_IMPLEMENTATION_PLAN.md "Data Growth
 * semantics" for why this is the correct definition, not a guess. */
const PRODUCTION_FILTER_SQL = `
  pn.phone_type IN ('MOBILE', 'LANDLINE')
  AND EXISTS (
    SELECT 1
    FROM phone_identities pi
    JOIN phone_identity_evidence pie ON pie.phone_identity_id = pi.id
    JOIN phone_observations po ON po.id = pie.phone_observation_id
    JOIN raw_documents rd ON rd.id = po.raw_document_id
    JOIN data_sources ds ON ds.id = rd.source_id
    WHERE pi.phone_number_id = pn.id
      AND pi.status != 'REJECTED'
      AND ds.trust_level = 'HIGH'
      AND ds.name NOT LIKE 'Fixture%'
  )
`;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getObservationWindow() {
  const startedAtRaw = process.env.OBSERVATION_STARTED_AT;
  const durationHours = envInt("OBSERVATION_DURATION_HOURS", 72);
  const targetSeconds = durationHours * 3600;

  if (!startedAtRaw) {
    return { started_at: null, elapsed_seconds: 0, target_seconds: targetSeconds, remaining_seconds: targetSeconds };
  }

  const startedAt = new Date(startedAtRaw);
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000));
  return {
    started_at: startedAt.toISOString(),
    elapsed_seconds: elapsedSeconds,
    target_seconds: targetSeconds,
    remaining_seconds: Math.max(0, targetSeconds - elapsedSeconds),
  };
}

export async function getDataGrowth() {
  const observation = getObservationWindow();
  const observationSince = observation.started_at ?? new Date(0).toISOString();

  const result = await pool.query(`
    SELECT
      (SELECT count(*) FROM phone_numbers pn WHERE ${PRODUCTION_FILTER_SQL}) AS total_numbers,
      (SELECT count(*) FROM phone_numbers pn WHERE pn.first_seen_at > now() - interval '1 hour' AND ${PRODUCTION_FILTER_SQL}) AS added_1h,
      (SELECT count(*) FROM phone_numbers pn WHERE pn.first_seen_at > now() - interval '3 hours' AND ${PRODUCTION_FILTER_SQL}) AS added_3h,
      (SELECT count(*) FROM phone_numbers pn WHERE pn.first_seen_at > now() - interval '6 hours' AND ${PRODUCTION_FILTER_SQL}) AS added_6h,
      (SELECT count(*) FROM phone_numbers pn WHERE pn.first_seen_at > now() - interval '9 hours' AND ${PRODUCTION_FILTER_SQL}) AS added_9h,
      (SELECT count(*) FROM phone_numbers pn WHERE pn.first_seen_at > now() - interval '12 hours' AND ${PRODUCTION_FILTER_SQL}) AS added_12h,
      (SELECT count(*) FROM phone_numbers pn WHERE pn.first_seen_at > now() - interval '24 hours' AND ${PRODUCTION_FILTER_SQL}) AS added_24h,
      (SELECT count(*) FROM phone_numbers pn WHERE pn.first_seen_at > $1::timestamptz AND ${PRODUCTION_FILTER_SQL}) AS added_observation
  `, [observationSince]);

  const r = result.rows[0];
  return {
    total_numbers: Number(r.total_numbers),
    added: {
      "1h": Number(r.added_1h),
      "3h": Number(r.added_3h),
      "6h": Number(r.added_6h),
      "9h": Number(r.added_9h),
      "12h": Number(r.added_12h),
      "24h": Number(r.added_24h),
      observation: Number(r.added_observation),
    },
  };
}

export async function getDataGrowthTimeSeries(windowHours: 24 | 72) {
  const result = await pool.query(
    `
    SELECT date_trunc('hour', pn.first_seen_at) AS bucket, count(*) AS n
    FROM phone_numbers pn
    WHERE pn.first_seen_at > now() - (interval '1 hour' * $1) AND ${PRODUCTION_FILTER_SQL}
    GROUP BY bucket
    ORDER BY bucket ASC
    `,
    [windowHours]
  );
  return result.rows.map((row) => ({ bucket: row.bucket, count: Number(row.n) }));
}

export async function getJobsSummary() {
  const result = await pool.query(`
    SELECT
      (SELECT count(*) FROM crawl_jobs WHERE status = 'PENDING') AS pending,
      (SELECT count(*) FROM crawl_jobs WHERE status = 'RUNNING') AS running,
      (SELECT count(*) FROM crawl_jobs WHERE status = 'SUCCESS') AS completed,
      (SELECT count(*) FROM crawl_jobs WHERE status = 'FAILED') AS failed,
      (SELECT count(*) FROM crawl_jobs WHERE status = 'SUCCESS' AND finished_at > now() - interval '1 hour') AS completed_1h,
      (SELECT count(*) FROM crawl_jobs WHERE status = 'SUCCESS' AND finished_at > now() - interval '6 hours') AS completed_6h,
      (SELECT count(*) FROM crawl_jobs WHERE status = 'SUCCESS' AND finished_at > now() - interval '24 hours') AS completed_24h,
      (SELECT count(*) FROM crawl_jobs WHERE status = 'FAILED' AND finished_at > now() - interval '1 hour') AS failed_1h,
      (SELECT count(*) FROM crawl_jobs WHERE status = 'FAILED' AND finished_at > now() - interval '24 hours') AS failed_24h,
      (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at - started_at))), 0) FROM crawl_jobs WHERE status = 'SUCCESS' AND finished_at > now() - interval '24 hours') AS average_duration_seconds
  `);
  const r = result.rows[0];
  return {
    pending: Number(r.pending),
    running: Number(r.running),
    completed: Number(r.completed),
    failed: Number(r.failed),
    completed_1h: Number(r.completed_1h),
    completed_6h: Number(r.completed_6h),
    completed_24h: Number(r.completed_24h),
    failed_1h: Number(r.failed_1h),
    failed_24h: Number(r.failed_24h),
    average_duration_seconds: Number(Number(r.average_duration_seconds).toFixed(1)),
  };
}

export async function getRunningJobs() {
  const result = await pool.query(`
    SELECT cj.id, cj.job_type, ds.name AS source_name, cj.started_at, cj.attempt_count, cj.max_attempts
    FROM crawl_jobs cj
    LEFT JOIN data_sources ds ON ds.id = cj.source_id
    WHERE cj.status = 'RUNNING'
    ORDER BY cj.started_at ASC
  `);
  return result.rows.map((row) => ({
    id: row.id,
    jobType: row.job_type,
    sourceName: row.source_name,
    startedAt: row.started_at,
    durationSeconds: row.started_at ? Math.floor((Date.now() - new Date(row.started_at).getTime()) / 1000) : null,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
  }));
}

export interface QueueHealthThresholds {
  warningPending: number;
  criticalPending: number;
  warningAgeMinutes: number;
  criticalAgeMinutes: number;
}

export function readQueueHealthThresholds(): QueueHealthThresholds {
  return {
    warningPending: envInt("QUEUE_WARNING_PENDING_JOBS", 10),
    criticalPending: envInt("QUEUE_CRITICAL_PENDING_JOBS", 30),
    warningAgeMinutes: envInt("QUEUE_WARNING_AGE_MINUTES", 60),
    criticalAgeMinutes: envInt("QUEUE_CRITICAL_AGE_MINUTES", 180),
  };
}

export function evaluateQueueHealth(
  pendingJobs: number,
  oldestPendingAgeSeconds: number | null,
  thresholds: QueueHealthThresholds
): "HEALTHY" | "WARNING" | "CRITICAL" {
  const ageMinutes = oldestPendingAgeSeconds != null ? oldestPendingAgeSeconds / 60 : 0;

  if (pendingJobs >= thresholds.criticalPending || ageMinutes >= thresholds.criticalAgeMinutes) {
    return "CRITICAL";
  }
  if (pendingJobs >= thresholds.warningPending || ageMinutes >= thresholds.warningAgeMinutes) {
    return "WARNING";
  }
  return "HEALTHY";
}

export async function getQueueHealth() {
  const result = await pool.query(`
    SELECT
      (SELECT count(*) FROM crawl_jobs WHERE status = 'PENDING') AS pending,
      (SELECT count(*) FROM crawl_jobs WHERE status = 'RUNNING') AS running,
      (SELECT EXTRACT(EPOCH FROM (now() - MIN(scheduled_at))) FROM crawl_jobs WHERE status = 'PENDING') AS oldest_pending_age_seconds,
      (SELECT count(*) FROM crawl_jobs WHERE status = 'FAILED' AND finished_at > now() - interval '24 hours') AS failed_24h
  `);
  const r = result.rows[0];
  const pending = Number(r.pending);
  const oldestPendingAgeSeconds = r.oldest_pending_age_seconds != null ? Math.floor(Number(r.oldest_pending_age_seconds)) : null;
  const thresholds = readQueueHealthThresholds();

  return {
    pending,
    running: Number(r.running),
    oldest_pending_age_seconds: oldestPendingAgeSeconds,
    failed_24h: Number(r.failed_24h),
    status: evaluateQueueHealth(pending, oldestPendingAgeSeconds, thresholds),
  };
}

export async function getLatestSystemMetrics() {
  const result = await pool.query(`
    SELECT cpu_percent, load_1, load_5, load_15, memory_total_bytes, memory_available_bytes,
           disk_total_bytes, disk_available_bytes, recorded_at
    FROM system_metrics
    ORDER BY recorded_at DESC
    LIMIT 1
  `);
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    recorded_at: r.recorded_at,
    cpu_percent: r.cpu_percent != null ? Number(r.cpu_percent) : null,
    load_1: r.load_1 != null ? Number(r.load_1) : null,
    load_5: r.load_5 != null ? Number(r.load_5) : null,
    load_15: r.load_15 != null ? Number(r.load_15) : null,
    memory_total_bytes: Number(r.memory_total_bytes),
    memory_available_bytes: Number(r.memory_available_bytes),
    disk_total_bytes: Number(r.disk_total_bytes),
    disk_available_bytes: Number(r.disk_available_bytes),
  };
}

const WINDOW_HOURS: Record<string, number> = { "6h": 6, "24h": 24, "72h": 72 };

export async function getSystemMetricsHistory(window: string) {
  const hours = WINDOW_HOURS[window] ?? 24;
  const result = await pool.query(
    `
    SELECT recorded_at, cpu_percent, load_1, memory_total_bytes, memory_available_bytes,
           disk_total_bytes, disk_available_bytes
    FROM system_metrics
    WHERE recorded_at > now() - (interval '1 hour' * $1)
    ORDER BY recorded_at ASC
    `,
    [hours]
  );
  return result.rows.map((r) => ({
    recorded_at: r.recorded_at,
    cpu_percent: r.cpu_percent != null ? Number(r.cpu_percent) : null,
    load_1: r.load_1 != null ? Number(r.load_1) : null,
    memory_total_bytes: Number(r.memory_total_bytes),
    memory_available_bytes: Number(r.memory_available_bytes),
    disk_total_bytes: Number(r.disk_total_bytes),
    disk_available_bytes: Number(r.disk_available_bytes),
  }));
}

export async function getMonitoringSummary() {
  const [observation, data, jobs, queue, system] = await Promise.all([
    Promise.resolve(getObservationWindow()),
    getDataGrowth(),
    getJobsSummary(),
    getQueueHealth(),
    getLatestSystemMetrics(),
  ]);

  return { observation, data, jobs, queue, system };
}
