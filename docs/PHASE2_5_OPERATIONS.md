# Phase 2.5 Operations — running the acquisition engine on the VPS

## Architecture

```
systemd: crawler-scheduler.service          systemd: crawler-worker.service
  python -m jobs.scheduler --loop 300          python -m jobs.worker --loop 30
  |                                              |
  | every 300s: caps at MAX_ACTIVE_JOBS,         | claims + runs one job at a time,
  | MAX_JOBS_PER_SCHEDULER_RUN, skips             | SIGTERM/SIGINT -> finishes current
  | MANUAL/already-active sources                 | job, stops claiming, exits
  v                                              v
              crawl_jobs (Postgres, shared table -- the queue)
              also written to directly by apps/api's
              POST /api/v1/discovery/domain
```

Both processes are independent, restartable, and safe to run more than one
worker instance of (the `FOR UPDATE SKIP LOCKED` claim in
`services/crawler/jobs/queue.py` plus the partial unique indexes from
`database/migrations/0004_scheduler_guardrails.sql` make concurrent
claiming/scheduling race-safe). Only one scheduler instance should run —
two schedulers don't corrupt anything (the same unique indexes protect
against duplicate job creation), but there's no benefit to two.

## Installation

```bash
# On the VPS, as the deploy user:
sudo cp deploy/systemd/crawler-worker.service deploy/systemd/crawler-scheduler.service /etc/systemd/system/
# Edit both units' WorkingDirectory/EnvironmentFile/ExecStart paths to the
# actual deploy path (the committed files use /opt/vn-phone-dp as a
# placeholder, not any real path).
sudo systemctl daemon-reload
sudo systemctl enable --now crawler-scheduler.service crawler-worker.service
```

## Status / logs / restart / stop

```bash
sudo systemctl status crawler-worker.service crawler-scheduler.service
sudo journalctl -u crawler-worker.service -f       # live tail
sudo journalctl -u crawler-worker.service --since "1 hour ago"
sudo systemctl restart crawler-worker.service       # graceful: SIGTERM first, SIGKILL after TimeoutStopSec
sudo systemctl stop crawler-worker.service crawler-scheduler.service
```

## Configuration (`services/crawler/config.py`, env vars in `.env`)

| Variable | Default | Meaning |
|---|---|---|
| `MAX_JOBS_PER_SCHEDULER_RUN` | 10 | Max new jobs one scheduler pass may create |
| `MAX_ACTIVE_JOBS` | 5 | Global cap on PENDING+RUNNING+RETRY jobs; scheduler creates nothing once hit |
| `SCHEDULER_INTERVAL_SECONDS` | 300 | Default sleep between scheduler passes (overridden by `--loop N` if passed) |
| `WORKER_CONCURRENCY` | 1 | Logged at worker startup; scaling today means running more worker *processes* (more systemd instances or a template unit), not in-process threads — `FOR UPDATE SKIP LOCKED` is what makes that safe |
| `WORKER_IDLE_SLEEP_SECONDS` | 5 | Sleep when the queue is empty and no `--loop` value was passed |
| `JOB_STALE_TIMEOUT_MINUTES` | 30 | A `RUNNING` job locked longer than this (worker crashed) is recovered back to `RETRY` |

## Operational API

- `GET /api/v1/acquisition/job-stats` — job counts by status, active count,
  last-24h completed/failed, `last_job_started_at` (evidence a worker
  recently ran something — not a real heartbeat/health-check, since there's
  no separate liveness channel; an idle worker with an empty queue looks
  identical to a dead one by this field alone).
- `GET /api/v1/acquisition/jobs?status=&job_type=&limit=` — existing
  endpoint (Phase 2), unchanged.
- `GET /api/v1/acquisition/stats` — existing data-quality/yield metrics
  (Phase 2), unchanged; kept separate from `job-stats` on purpose (queue
  health vs. data quality are different questions).
- Web UI: the "Vận hành" tab in `apps/web/` (https://vn-phone.tuandv.id.vn)
  shows the same job-stats + recent jobs table, read-only, no auth (same
  trust model as the rest of that public site).

## Guardrails (why a scheduler run can't repeat the 43-job incident)

1. `MAX_ACTIVE_JOBS` — scheduler refuses to create anything once the queue
   already has this many active jobs, full stop.
2. `MAX_JOBS_PER_SCHEDULER_RUN` — even with headroom, one pass creates at
   most this many; a backlog of due sources drains gradually across
   multiple passes instead of all at once.
3. `crawl_frequency = 'MANUAL'` is excluded at the SQL level in
   `get_sources_due_for_discovery` (Phase 2.5) — not just via the one-off
   `next_scheduled_at` patch applied to the 36 hand-vetted sources after
   the original incident. A newly added `MANUAL` source is safe by
   construction now.
4. `crawl_jobs_active_target_uq` / `crawl_jobs_active_source_type_uq`
   (migration 0004) — DB-level rejection of a second active job for the
   same target/source, closing the race that a Python-level
   check-then-insert can't close on its own if two scheduler processes
   somehow run concurrently.

## Known limitations

- No in-process worker concurrency — `WORKER_CONCURRENCY` is read/logged
  but scaling beyond one job at a time means running additional systemd
  worker instances, not implemented as a template unit in this phase.
- `last_job_started_at` is not a real health check; there's no dedicated
  liveness/heartbeat mechanism. If a worker process dies, systemd's
  `Restart=always` brings it back, but nothing pages anyone if it's stuck
  restart-looping — only manual `systemctl status` / `journalctl` checks
  catch that today.
- The scheduler process itself has no SIGTERM-based graceful drain (unlike
  the worker) — each pass is a handful of fast queries, so this was judged
  unnecessary complexity for this phase; `systemctl stop` may interrupt a
  pass mid-way, which is safe (the next pass just re-evaluates from
  current DB state) but not literally "graceful."
