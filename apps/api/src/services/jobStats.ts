import { pool } from "../db/client.js";

/** Job-state counts + recent 24h outcomes -- separate from
 * getAcquisitionStats() (crawling/discovery/data/quality yield metrics)
 * to avoid conflating "is the queue healthy" with "is the data good". */
export async function getJobStats() {
  const [byStatus, recent, liveness] = await Promise.all([
    pool.query(`
      SELECT status, count(*) AS n
      FROM crawl_jobs
      GROUP BY status
    `),
    pool.query(`
      SELECT
        count(*) FILTER (WHERE status = 'SUCCESS' AND finished_at > now() - interval '24 hours') AS completed_24h,
        count(*) FILTER (WHERE status = 'FAILED' AND finished_at > now() - interval '24 hours') AS failed_24h
      FROM crawl_jobs
    `),
    pool.query(`
      SELECT max(started_at) AS last_job_started_at
      FROM crawl_jobs
      WHERE started_at IS NOT NULL
    `),
  ]);

  const counts: Record<string, number> = {
    PENDING: 0,
    RUNNING: 0,
    SUCCESS: 0,
    FAILED: 0,
    RETRY: 0,
    CANCELLED: 0,
  };
  for (const row of byStatus.rows) {
    counts[row.status] = Number(row.n);
  }

  const r = recent.rows[0];
  const lastJobStartedAt: string | null = liveness.rows[0].last_job_started_at;

  return {
    by_status: counts,
    active: counts.PENDING + counts.RUNNING + counts.RETRY,
    last_24h: {
      completed: Number(r.completed_24h),
      failed: Number(r.failed_24h),
    },
    // Not a real health-check (no heartbeat channel exists) -- just the
    // most recent evidence a worker process actually ran a job. A worker
    // that's been idle because the queue is genuinely empty looks the
    // same as one that's down; this field only tells you the last time
    // something *did* run, not whether a worker is currently alive.
    last_job_started_at: lastJobStartedAt,
  };
}
