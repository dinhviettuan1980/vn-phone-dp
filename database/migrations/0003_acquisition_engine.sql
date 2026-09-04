-- Phase 2: Data Acquisition Engine. Purely additive -- no existing table's
-- existing columns are altered or dropped. See docs/PHASE2_IMPLEMENTATION_PLAN.md.

-- ============================================================
-- Job queue -- Postgres-backed, no Redis/BullMQ (matches Phase 1's
-- "simplest solution that fits" decision for the URL queue).
-- ============================================================
CREATE TYPE job_type AS ENUM (
  'CRAWL_SOURCE',
  'CRAWL_URL',
  'DISCOVER_DOMAIN',
  'DISCOVER_SITEMAP',
  'INGEST_DATASET',
  'RECRAWL'
);

CREATE TYPE job_status AS ENUM (
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'RETRY',
  'CANCELLED'
);

CREATE TABLE crawl_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type        job_type NOT NULL,
  source_id       UUID REFERENCES data_sources(id) ON DELETE CASCADE,
  crawl_target_id UUID REFERENCES crawl_targets(id) ON DELETE CASCADE,
  priority        INTEGER NOT NULL DEFAULT 100,
  status          job_status NOT NULL DEFAULT 'PENDING',
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  locked_at       TIMESTAMPTZ,
  locked_by       TEXT,
  error_message   TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Claim query filters on these together; composite index matches the
-- ORDER BY in queue.py's claim statement.
CREATE INDEX crawl_jobs_claim_idx ON crawl_jobs(status, scheduled_at, priority DESC);
CREATE INDEX crawl_jobs_source_idx ON crawl_jobs(source_id);
CREATE INDEX crawl_jobs_locked_idx ON crawl_jobs(status, locked_at) WHERE status = 'RUNNING';

-- ============================================================
-- Bulk dataset ingestion provenance
-- ============================================================
CREATE TYPE dataset_format AS ENUM ('CSV', 'XLSX', 'JSON');
CREATE TYPE dataset_status AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

CREATE TABLE datasets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       UUID REFERENCES data_sources(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  dataset_url     TEXT,
  format          dataset_format NOT NULL,
  license_notes   TEXT,
  checksum        TEXT NOT NULL,
  row_count       INTEGER,
  processed_rows  INTEGER NOT NULL DEFAULT 0,
  status          dataset_status NOT NULL DEFAULT 'PENDING',
  downloaded_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX datasets_source_idx ON datasets(source_id);
CREATE UNIQUE INDEX datasets_checksum_uq ON datasets(checksum);

-- ============================================================
-- Domain discovery runs (one row per discovery invocation, not per URL --
-- URLs discovered become ordinary crawl_targets rows, reusing that table
-- exactly as Phase 1 built it).
-- ============================================================
CREATE TYPE discovery_status AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

CREATE TABLE domain_discoveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id           UUID REFERENCES data_sources(id) ON DELETE CASCADE,
  domain              TEXT NOT NULL,
  robots_found        BOOLEAN NOT NULL DEFAULT false,
  sitemaps_found      INTEGER NOT NULL DEFAULT 0,
  urls_discovered     INTEGER NOT NULL DEFAULT 0,
  urls_high_priority  INTEGER NOT NULL DEFAULT 0,
  urls_queued         INTEGER NOT NULL DEFAULT 0,
  status              discovery_status NOT NULL DEFAULT 'SUCCESS',
  error_message       TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX domain_discoveries_source_idx ON domain_discoveries(source_id);

-- ============================================================
-- Scheduling additions to existing tables (additive only)
-- ============================================================
ALTER TABLE data_sources ADD COLUMN crawl_frequency TEXT NOT NULL DEFAULT 'WEEKLY';
ALTER TABLE data_sources ADD COLUMN next_scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE crawl_targets ADD COLUMN etag TEXT;
ALTER TABLE crawl_targets ADD COLUMN last_modified TEXT;
