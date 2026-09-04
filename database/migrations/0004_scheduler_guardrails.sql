-- Phase 2.5: DB-level duplicate-active-job protection. Purely additive --
-- no existing table's columns are altered or dropped. See
-- docs/PHASE2_5_IMPLEMENTATION_PLAN.md.
--
-- jobs/scheduler.py already checks has_pending_job_for_target /
-- has_pending_job_for_source before inserting, but that check-then-insert
-- is not atomic across two concurrent scheduler processes. These partial
-- unique indexes make the DB itself reject a second active job for the
-- same target/source, closing that race.
CREATE UNIQUE INDEX crawl_jobs_active_target_uq
  ON crawl_jobs (crawl_target_id)
  WHERE status IN ('PENDING', 'RUNNING', 'RETRY') AND crawl_target_id IS NOT NULL;

CREATE UNIQUE INDEX crawl_jobs_active_source_type_uq
  ON crawl_jobs (source_id, job_type)
  WHERE status IN ('PENDING', 'RUNNING', 'RETRY') AND crawl_target_id IS NULL;
