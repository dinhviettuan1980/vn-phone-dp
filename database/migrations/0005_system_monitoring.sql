-- Phase 2.6: lightweight VPS resource snapshots for the 3-day production
-- observation window. Purely additive. See docs/PHASE2_6_IMPLEMENTATION_PLAN.md.
CREATE TABLE system_metrics (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  cpu_percent             NUMERIC(5,2),
  load_1                  NUMERIC(6,2),
  load_5                  NUMERIC(6,2),
  load_15                 NUMERIC(6,2),
  memory_total_bytes      BIGINT,
  memory_available_bytes  BIGINT,
  disk_total_bytes        BIGINT,
  disk_available_bytes    BIGINT
);

-- All dashboard/API queries filter by a recent time window ("last 6h/24h/72h") --
CREATE INDEX system_metrics_recorded_at_idx ON system_metrics(recorded_at DESC);
