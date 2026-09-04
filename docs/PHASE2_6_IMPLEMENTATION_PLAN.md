# Phase 2.6 Implementation Plan — 3-Day Production Observation & Monitoring

## 1. Current architecture (re-verified before writing this)

- Production VPS (`103.163.216.32`): single filesystem, `/` (22G, 62% used
  at inspection time) — Postgres's data dir (`/var/lib/postgresql/16/main`)
  is on the same mount as everything else. No separate mount to worry
  about; monitoring `/` via `os.statvfs("/")` is actually correct here, not
  an assumption.
- 2 vCPU, ~1.9GB RAM (`/proc/meminfo` has `MemAvailable`, so "available"
  semantics are directly readable, no derivation needed).
- No `psutil` in `services/crawler/requirements.txt` — collector will
  parse `/proc/stat` (CPU), `/proc/loadavg`, `/proc/meminfo`, and
  `os.statvfs` (disk) directly. No new dependency justified for 3 numbers.
- Phase 2's `crawl_jobs` / `datasets` / `domain_discoveries` tables were
  never added to `apps/api/src/db/schema.ts` (Drizzle) — Phase 2's TS
  services (`acquisition.ts`, `jobStats.ts`) use raw `pool.query` instead.
  `system_metrics` follows the same precedent: no schema.ts change.
- Route registration is a flat list in `apps/api/src/index.ts`
  (`await app.register(xRoutes)`); existing routes: `phones`, `stats`,
  `callDirectory`, `callLog`, `acquisition`. Adding `monitoring.ts`
  the same way.
- `apps/web/` (index.html/app.js/style.css, no build step) already has the
  "Vận hành" tab from Phase 2.5 wired to `/api/v1/acquisition/job-stats`
  and `/api/v1/acquisition/jobs`. This phase extends that tab in place
  rather than adding a new one.

## 2. Data growth semantics — the critical decision (not guessed)

**What counts as "new phone number in production":**

```sql
phone_numbers row where:
  first_seen_at >= <window start>          -- genuinely new row, not a re-crawl
  AND EXISTS (                              -- satisfies the SAME rule
    ... HIGH trust evidence, non-Fixture ...  -- callDirectoryExport.ts uses
  )
  AND phone_type IN ('MOBILE', 'LANDLINE')
```

Reasoning, traced through the actual schema (not assumed):

- `phone_numbers.first_seen_at` is set once at INSERT
  (`DEFAULT now()`) and is **never** touched again —
  `storage/postgres_repository.py::upsert_phone_number`'s
  `ON CONFLICT ... DO UPDATE SET` only touches `observation_count`,
  `last_seen_at`, `updated_at`, `phone_type`. A re-crawl of an
  already-known number updates `last_seen_at`, not `first_seen_at`. So
  filtering on `first_seen_at >= window` already excludes re-crawls and
  duplicates by construction — no extra dedup logic needed.
- "Published to production" is not a separate boolean anywhere in the
  schema — it's a *derived* condition, and the one place that condition is
  already implemented and battle-tested is
  `apps/api/src/services/callDirectoryExport.ts::getCallDirectoryEntries`
  (trust_level = 'HIGH', source name not `Fixture%`, phone_type
  MOBILE/LANDLINE, identity status != REJECTED). Reusing that exact
  `EXISTS` subquery for the dashboard's "new numbers" metric is what makes
  the spec's requirement ("must match the actual production export rule")
  literally true, not just similar. MEDIUM/LOW trust (auto-discovery,
  dataset ingestion, not yet human-reviewed) and REJECTED identities are
  excluded because that subquery excludes them.
- `total_numbers` = same `EXISTS` filter, no time bound → current
  production count, directly comparable to what a real iPhone's caller ID
  export contains right now.

This is not a new concept bolted on — it's "count rows already excluded/
included by the export query, grouped by `first_seen_at` window."

## 3. Observation window

Option A (env var) chosen over B/C: `OBSERVATION_STARTED_AT` in
`apps/api/.env` (production) — a single wall-clock timestamp, read by the
API to compute elapsed/remaining. No DB table, no experiment framework.
Set once, at the moment Part 20 actually starts the observation (not at
implementation time — implementation and observation start are different
moments per the spec's own Step 3 ordering, item 11 last).

## 4. System metrics collection

New `services/crawler/monitoring/`:
- `system_metrics.py` — pure stdlib functions: `read_cpu_percent()` (two
  `/proc/stat` samples 1s apart, standard idle/total delta method),
  `read_loadavg()` (`/proc/loadavg`), `read_memory()` (`/proc/meminfo`:
  `MemTotal`, `MemAvailable` → used = total - available, matches the
  spec's "prefer available memory semantics"), `read_disk()`
  (`os.statvfs("/")`).
- `collector.py` — `collect_and_store(conn)` calls the above, inserts one
  `system_metrics` row. `main()` — same `--loop N` / signal-handling shape
  as `jobs/worker.py` (SIGTERM/SIGINT → finish current snapshot, exit).
- No separate `repository.py` — one small INSERT doesn't need a layer of
  its own; `collector.py` writes directly via `storage.postgres_repository`
  the same way `jobs/worker.py` does today (adding one function there:
  `insert_system_metrics_snapshot`).

## 5. Database migration (`0005_system_monitoring.sql`)

```sql
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
CREATE INDEX system_metrics_recorded_at_idx ON system_metrics(recorded_at DESC);
```

Only what's asked for — no derived `memory_used`/`disk_used` columns
(computed as `total - available` at query time, per spec: "avoid storing
derived fields that can be calculated"). Purely additive, no existing
table touched.

## 6. Monitoring API

`apps/api/src/services/monitoring.ts` + `apps/api/src/routes/monitoring.ts`,
registered in `index.ts`. Endpoints:

- `GET /api/v1/monitoring/summary` — the dashboard's one-call payload
  (observation + data growth + jobs + queue + system, per the spec's
  conceptual JSON).
- `GET /api/v1/monitoring/data-growth?window=24h|72h` — hourly-bucketed
  time series for the chart (Part 3), same production-rule filter as
  above, `GROUP BY date_trunc('hour', first_seen_at)`.
- `GET /api/v1/monitoring/system-metrics?window=6h|24h|72h` — raw snapshot
  rows from `system_metrics` in the window (≤864 rows at 72h/5min, no
  server-side downsampling needed at that volume).

Explicitly NOT duplicating `/api/v1/acquisition/job-stats` or
`/api/v1/acquisition/jobs` — `summary.jobs` reuses the same status-count
query shape but is computed in `monitoring.ts` because it needs to sit
alongside data/queue/system in one response; `jobs` (running jobs table)
calls the existing `listJobs(status: "RUNNING")` from `acquisition.ts`
rather than re-implementing it.

## 7. Queue health thresholds

`QUEUE_WARNING_PENDING_JOBS=10`, `QUEUE_CRITICAL_PENDING_JOBS=30`,
`QUEUE_WARNING_AGE_MINUTES=60`, `QUEUE_CRITICAL_AGE_MINUTES=180` — read
from `process.env` in `monitoring.ts` (TS side owns this since the API,
not the Python worker, computes queue-health status for the dashboard).
Logic: CRITICAL if pending ≥ critical threshold OR oldest-pending-age ≥
critical minutes; WARNING if either warning threshold crossed; else
HEALTHY.

## 8. systemd

`deploy/systemd/system-metrics.service` — same shape as
`crawler-worker.service` (placeholder paths, `Restart=always`,
`RestartSec=10`, `KillSignal=SIGTERM`), running
`python -m monitoring.collector --loop 300`.

## 9. Dashboard (extend "Vận hành" tab in place)

Sections added to `apps/web/index.html`/`app.js`/`style.css`, in the order
from Part 12: Observation header (progress bar), Data Growth (numbers +
existing `.stats-row` pattern), Data Growth chart (lightweight — inspected
`apps/web/`: no chart library present at all, and 24h/72h hourly bars is
exactly what plain CSS bar divs already do for `.confidence-bar` — reusing
that technique, not adding a chart library), Pipeline status cards, Currently
Running Jobs table (reusing `renderPhoneTable` helper), Throughput, Queue
Health (status pill, reusing the `.status-pill` classes from Phase 2.5),
VPS Resources + historical bars. Auto-refresh every
`MONITORING_DASHBOARD_REFRESH_SECONDS` (default 60) via `setInterval`,
"Last updated: HH:MM:SS", stale-data indicator on fetch failure (keep
last-good render, don't blank the page).

## 10. Test strategy

- `services/crawler/tests/test_system_metrics.py` — unit tests for
  `/proc`/`statvfs` parsing against fixture strings (not the real
  machine), snapshot insertion against the dev DB (DATABASE_URL-gated,
  existing pattern).
- `apps/api/src/__tests__/monitoring.test.ts` — data-growth window
  correctness (seed rows with different `first_seen_at`, assert correct
  bucketing and exclusion of non-HIGH-trust/rejected/fixture rows), queue
  health threshold logic (pure function, no DB), summary/system-metrics
  endpoint shape.

## 11. What is explicitly NOT observable, per the spec's own instruction

Worker restart count is not recorded anywhere (systemd's own restart
counter is process-local and resets on `daemon-reload`/reboot, not queried
by anything here). The final report and dashboard will say this plainly
rather than inventing a number.
