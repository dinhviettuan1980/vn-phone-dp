# Phase 2.5 Implementation Plan — Production Automation & Data Operations

## 1. Current architecture understanding (re-verified before writing this)

- `crawl_jobs.status` enum (from `database/migrations/0003_acquisition_engine.sql`,
  confirmed by reading the actual migration, not assumed): `PENDING`,
  `RUNNING`, `SUCCESS`, `FAILED`, `RETRY`, `CANCELLED`. **Active** states =
  `PENDING`, `RUNNING`, `RETRY`.
- `services/crawler/jobs/queue.py`: `create_job`, `claim_job` (atomic,
  `FOR UPDATE SKIP LOCKED`), `complete_job`, `fail_job` (exponential
  backoff: `30 * 2^(attempt-1)` seconds), `recover_stale_jobs` (10-minute
  hardcoded threshold).
- `services/crawler/jobs/worker.py`: `run_once()` loops `claim_job` until
  empty, dispatches by `job_type` to handlers, catches all exceptions per
  job. `main()` supports `--loop N` (sleep N seconds between passes) or a
  single pass. No signal handling, no concurrency control, no idle logging
  beyond one final line.
- `services/crawler/jobs/scheduler.py`: `run_once()` calls
  `schedule_due_crawl_targets` (every due `crawl_targets` row → a
  `CRAWL_URL` job, deduped via `has_pending_job_for_target`) and
  `schedule_due_discoveries` (every due `data_sources` row →
  `DISCOVER_SITEMAP`, deduped via `has_pending_job_for_source`, then
  unconditionally advances `next_scheduled_at`). **No cap on either loop**
  — this is exactly the gap Phase 2.5 Part 1 asks to close (and exactly
  what caused the real incident documented in `docs/architecture.md`
  "Phase 2" section, where the first scheduler run created 43 discovery
  jobs against real banks before `crawl_frequency = MANUAL` was retrofitted).
- `data_sources.crawl_frequency` (`TEXT`, default `WEEKLY`; 36 hand-vetted
  sources were set to `MANUAL` post-incident) and `next_scheduled_at`
  already exist — eligibility already has the field it needs, just not a
  named function enforcing it consistently everywhere.
- `apps/api/src/services/acquisition.ts` / `routes/acquisition.ts`:
  `listJobs`, `getJob`, `getAcquisitionStats` (crawling/discovery/data/
  quality — Phase 2's metrics, not job-state counts), `getSourcePerformance`,
  `enqueueDomainDiscovery`. No job-status breakdown (pending/running/
  completed/failed counts) exists yet — Part 5.1 is a real gap, not a
  duplicate.
- `apps/web/`: 2-tab static site (Tra cứu, Nhật ký cuộc gọi), no admin/ops
  page. No auth anywhere in the project (public FE by design) — a new ops
  tab is the same trust model as the rest of the site, not a new auth
  surface.
- No systemd units exist. No `.env.example` entries for any of the
  Phase 2.5 config knobs.

## 2. Files that will change

**New:**
- `database/migrations/0004_scheduler_guardrails.sql` (see §3 — the one
  migration this phase needs)
- `services/crawler/config.py` — central place for the new env-driven
  config, so `queue.py`/`worker.py`/`scheduler.py` don't each parse
  `os.environ` independently
- `deploy/systemd/crawler-worker.service`, `deploy/systemd/crawler-scheduler.service`
- `services/crawler/tests/test_scheduler_guardrails.py`,
  `services/crawler/tests/test_worker_lifecycle.py`
- `apps/api/src/services/jobStats.ts` (job-state counts, separate from
  the existing data-quality `acquisition/stats` to avoid conflating the
  two, per Part 5.1's explicit JSON shape)
- `apps/web`: new "Vận hành" tab (index.html/app.js/style.css additions,
  same no-build-step pattern as the existing tabs)
- `docs/PHASE2_5_OPERATIONS.md`

**Modified:**
- `services/crawler/jobs/scheduler.py` — add `is_source_eligible_for_scheduling`,
  `MAX_JOBS_PER_SCHEDULER_RUN`, `MAX_ACTIVE_JOBS`, deterministic sort,
  summary logging
- `services/crawler/jobs/worker.py` — signal handling (SIGTERM/SIGINT),
  `WORKER_IDLE_SLEEP_SECONDS`, structured start/claim/complete/idle logs
- `services/crawler/jobs/queue.py` — `JOB_STALE_TIMEOUT_MINUTES` from
  config instead of the hardcoded `STALE_LOCK_MINUTES` constant (same
  default, now configurable)
- `apps/api/src/routes/acquisition.ts` — register the new job-stats route
- `.env.example` — document every new variable

**Untouched, reused as-is (per "no parallel pipeline"):**
`extract_and_store_observations`, `HttpCollector`, `discover_domain`,
`ingest_dataset`, `normalize_vietnam_phone`, all of `apps/api/src/services/aggregation.ts`.

## 3. Database changes

One migration, and only because Requirement 1.2 explicitly asks for
DB-level (not just Python-level) duplicate-active-job protection, which a
plain `SELECT` check can't guarantee under two concurrent scheduler runs
(the exact race the requirement calls out):

```sql
-- database/migrations/0004_scheduler_guardrails.sql
-- Partial unique indexes: at most one ACTIVE (PENDING/RUNNING/RETRY) job
-- per crawl_target (CRAWL_URL/RECRAWL jobs) and per (source_id, job_type)
-- (CRAWL_SOURCE/DISCOVER_SITEMAP/DISCOVER_DOMAIN/INGEST_DATASET jobs).
-- A second INSERT attempting to violate this fails at the DB level even
-- if two scheduler processes race past the Python-level check.
CREATE UNIQUE INDEX crawl_jobs_active_target_uq
  ON crawl_jobs (crawl_target_id)
  WHERE status IN ('PENDING', 'RUNNING', 'RETRY') AND crawl_target_id IS NOT NULL;

CREATE UNIQUE INDEX crawl_jobs_active_source_type_uq
  ON crawl_jobs (source_id, job_type)
  WHERE status IN ('PENDING', 'RUNNING', 'RETRY') AND crawl_target_id IS NULL;
```

`create_job` in `queue.py` wraps the insert in a try/except for the
unique-violation case and returns the existing job's id instead of
raising — callers (scheduler) don't need to change their dedup-check
call sites, they just get a stronger guarantee underneath.

No other schema change. `crawl_frequency`/`next_scheduled_at`/`etag`/
`last_modified` from Phase 2 already cover everything else this phase
needs.

## 4. Scheduler lifecycle design

`is_source_eligible_for_scheduling(source) -> bool`:
- `is_active = false` → not eligible
- `crawl_frequency = 'MANUAL'` → not eligible
- `next_scheduled_at > now()` → not eligible (already filtered by the SQL
  `WHERE`, kept here too so the function is a complete, testable predicate)
- has an active `DISCOVER_SITEMAP`/`DISCOVER_DOMAIN` job already → not eligible

`run_once()` new shape:
1. Count active jobs (`status IN (PENDING,RUNNING,RETRY)`). If
   `>= MAX_ACTIVE_JOBS`, log and exit — create nothing this cycle.
2. Fetch due crawl_targets and due sources (existing queries, already
   bounded by `next_crawl_at`/`next_scheduled_at`), apply eligibility,
   sort deterministically (`id ASC` — stable across runs, not `priority`
   alone which could starve low-priority sources or reorder on ties).
3. Take `min(MAX_JOBS_PER_SCHEDULER_RUN, MAX_ACTIVE_JOBS - current_active)`
   from the combined, sorted list.
4. Create jobs for exactly that many; leave the rest for next cycle.
5. Log the exact summary shape from the spec (due/eligible/created/
   skipped-active/deferred).

`SCHEDULER_INTERVAL_SECONDS` becomes the `--loop` default when run under
systemd (Option A: long-running process, `Restart=always` — chosen over a
systemd timer because the existing `--loop` flag already implements this
exact pattern, adding a timer unit on top would be a second thing to keep
in sync with the same interval for no operational benefit).

## 5. Worker lifecycle design

- `WORKER_CONCURRENCY` is read and logged at startup but the actual claim
  loop stays single-threaded per process (matches "the existing atomic
  job claim mechanism should be the scaling primitive" — scaling to N
  workers means running N systemd service instances, not N threads in one
  process; `WORKER_CONCURRENCY` is documented as forward-looking config
  for that day, not implemented as in-process threading now, since
  `FOR UPDATE SKIP LOCKED` already makes multiple *processes* safe).
- `signal.signal(SIGTERM, ...)` / `SIGINT` set a module-level flag checked
  between jobs (not mid-job — Postgres queries aren't safely interruptible
  mid-statement, and `psycopg` connections don't handle async cancellation
  cleanly here). Current job finishes, no new `claim_job()` call happens,
  process exits 0. Documented explicitly: a job interrupted by `kill -9`
  (not caught) relies on stale-job recovery, same as an actual crash — no
  new failure mode introduced.
- Structured logs matching the spec's example shapes exactly (worker
  started/configuration, job claimed/completed, worker idle) — reusing
  the existing `[JOB]`/`[CRAWL]` prefixes already established in Phase 1/2
  rather than inventing a new log format.

## 6. systemd design

Two unit files in `deploy/systemd/`, `WorkingDirectory`/`ExecStart` using
a documented placeholder (`/opt/vn-phone-dp` in the template, real path
substituted at install time per `docs/PHASE2_5_OPERATIONS.md` — never the
developer's actual home directory hardcoded into a committed file).
`EnvironmentFile=` points at a `.env` on the server (not committed) for
the Phase 2.5 config variables. `Restart=always`, `RestartSec=10` on both.

## 7. Safety guardrail test strategy

New `test_scheduler_guardrails.py` (DB-integration, same `DATABASE_URL`
skip-gate as existing Phase 2 tests): the 5 scenarios listed in the spec's
Part 9, each asserting against the real `crawl_jobs`/`data_sources` tables
with cleanup. New `test_worker_lifecycle.py`: config is read correctly,
shutdown flag prevents further claims (unit-level, no DB needed for the
flag-check itself). All existing 67 tests must keep passing unmodified.

## 8. Deployment strategy

Implemented and tested locally/against the dev DB first (migration
applied, guardrail tests green, worker/scheduler run manually with the
new flags). Actual `systemctl enable --now` on the VPS is a distinct,
explicitly-confirmed step (see Final Report for what's "implemented" vs.
"deployed and verified on VPS" — not conflating the two, per the spec's
explicit instruction not to claim "production ready" without that
distinction).
