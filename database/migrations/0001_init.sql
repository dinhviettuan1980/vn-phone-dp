-- Vietnam Phone Intelligence Data Platform — Phase 1 schema
-- Principle: raw data is never overwritten. Every table below is append-mostly;
-- the only rows that get UPDATEd are aggregate counters/status columns.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ============================================================
-- 1. data_sources — Source Registry
-- ============================================================
CREATE TYPE source_type AS ENUM (
  'OFFICIAL_WEBSITE',
  'BUSINESS_DIRECTORY',
  'PUBLIC_DATASET',
  'NEWS',
  'GOVERNMENT',
  'USER_SUBMITTED',
  'OTHER'
);

CREATE TYPE trust_level AS ENUM ('HIGH', 'MEDIUM', 'LOW');

CREATE TABLE data_sources (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL UNIQUE,
  base_url          TEXT NOT NULL,
  source_type       source_type NOT NULL,
  country           TEXT NOT NULL DEFAULT 'VN',
  trust_level       trust_level NOT NULL DEFAULT 'MEDIUM',
  crawl_policy      JSONB NOT NULL DEFAULT '{}'::jsonb, -- e.g. {"crawl_delay_seconds":2,"max_concurrency":2}
  robots_checked    BOOLEAN NOT NULL DEFAULT false,
  license_notes     TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. crawl_targets — URL queue (Postgres-backed job table)
-- ============================================================
CREATE TYPE crawl_status AS ENUM (
  'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'SKIPPED'
);

CREATE TABLE crawl_targets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id         UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  url               TEXT NOT NULL,
  normalized_url    TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active', -- active | disabled
  priority          INTEGER NOT NULL DEFAULT 100,
  crawl_status      crawl_status NOT NULL DEFAULT 'PENDING',
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  last_crawled_at   TIMESTAMPTZ,
  next_crawl_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  http_status       INTEGER,
  content_hash      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX crawl_targets_normalized_url_uq ON crawl_targets(normalized_url);
CREATE INDEX crawl_targets_status_idx ON crawl_targets(crawl_status, next_crawl_at);
CREATE INDEX crawl_targets_source_idx ON crawl_targets(source_id);

-- ============================================================
-- 3. raw_documents — immutable raw evidence
-- ============================================================
CREATE TABLE raw_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id         UUID NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  crawl_target_id   UUID REFERENCES crawl_targets(id) ON DELETE SET NULL,
  url               TEXT NOT NULL,
  final_url         TEXT NOT NULL,
  title             TEXT,
  content_type      TEXT,
  http_status       INTEGER,
  content_hash      TEXT NOT NULL,
  -- raw_content stays inline for phase 1; column is isolated so a later
  -- migration can move it behind a storage_ref (S3/MinIO key) without
  -- touching any other table. See docs/scaling.md.
  raw_content       TEXT NOT NULL,
  fetched_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX raw_documents_content_hash_idx ON raw_documents(content_hash);
CREATE INDEX raw_documents_source_idx ON raw_documents(source_id);
CREATE INDEX raw_documents_crawl_target_idx ON raw_documents(crawl_target_id);

-- ============================================================
-- 4. phone_observations — one row per phone sighting, never deduped
-- ============================================================
CREATE TABLE phone_observations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_document_id   UUID NOT NULL REFERENCES raw_documents(id) ON DELETE CASCADE,
  phone_raw         TEXT NOT NULL,
  phone_normalized  TEXT, -- nullable: extraction can outrun normalization success
  context_text      TEXT NOT NULL,
  context_before    TEXT NOT NULL DEFAULT '',
  context_after     TEXT NOT NULL DEFAULT '',
  extraction_method TEXT NOT NULL, -- e.g. REGEX_TEXT, REGEX_TEL_HREF
  confidence        NUMERIC(5,4) NOT NULL DEFAULT 0.5,
  position_start    INTEGER NOT NULL,
  position_end      INTEGER NOT NULL,
  discovered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX phone_observations_normalized_idx ON phone_observations(phone_normalized);
CREATE INDEX phone_observations_raw_document_idx ON phone_observations(raw_document_id);

-- ============================================================
-- 5. phone_numbers — canonical identity
-- ============================================================
CREATE TYPE phone_type AS ENUM ('MOBILE', 'LANDLINE', 'HOTLINE_1800', 'HOTLINE_1900', 'SHORT_CODE', 'UNKNOWN');

CREATE TABLE phone_numbers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164        TEXT NOT NULL,
  country_code      TEXT NOT NULL DEFAULT '84',
  national_number   TEXT NOT NULL,
  phone_type        phone_type NOT NULL DEFAULT 'UNKNOWN',
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  observation_count INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX phone_numbers_e164_uq ON phone_numbers(phone_e164);

-- ============================================================
-- 6. phone_identities — competing/coexisting identity claims
-- ============================================================
CREATE TYPE identity_type AS ENUM ('PERSON', 'BUSINESS', 'HOTLINE', 'ORGANIZATION', 'UNKNOWN');

CREATE TYPE identity_category AS ENUM (
  'BANK', 'INSURANCE', 'TELECOM', 'HOSPITAL', 'GOVERNMENT', 'DELIVERY',
  'ECOMMERCE', 'REAL_ESTATE', 'TELEMARKETING', 'SPAM', 'SCAM', 'OTHER'
);

CREATE TYPE identity_status AS ENUM ('CANDIDATE', 'CONFIRMED', 'REJECTED');

CREATE TABLE phone_identities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number_id   UUID NOT NULL REFERENCES phone_numbers(id) ON DELETE CASCADE,
  display_name      TEXT NOT NULL,
  normalized_name   TEXT NOT NULL,
  identity_type     identity_type NOT NULL DEFAULT 'UNKNOWN',
  category          identity_category,
  claim_source      TEXT NOT NULL, -- e.g. 'rule_based_aggregation_v1'
  confidence        NUMERIC(5,2) NOT NULL DEFAULT 0,
  evidence_count    INTEGER NOT NULL DEFAULT 0,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status            identity_status NOT NULL DEFAULT 'CANDIDATE',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX phone_identities_phone_number_idx ON phone_identities(phone_number_id);
-- One identity row per (phone, normalized_name, claim_source): re-running
-- the SAME aggregator is idempotent (upsert), while a different aggregator
-- (e.g. a future LLM enrichment pass) producing the same name gets its own
-- row instead of silently overwriting the rule-based claim.
CREATE UNIQUE INDEX phone_identities_phone_name_source_uq ON phone_identities(phone_number_id, normalized_name, claim_source);

-- ============================================================
-- 7. phone_identity_evidence — link identity claims to observations
-- ============================================================
CREATE TABLE phone_identity_evidence (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_identity_id     UUID NOT NULL REFERENCES phone_identities(id) ON DELETE CASCADE,
  phone_observation_id  UUID NOT NULL REFERENCES phone_observations(id) ON DELETE CASCADE,
  evidence_weight       NUMERIC(5,2) NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX phone_identity_evidence_identity_idx ON phone_identity_evidence(phone_identity_id);
CREATE UNIQUE INDEX phone_identity_evidence_uq ON phone_identity_evidence(phone_identity_id, phone_observation_id);
