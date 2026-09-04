# Phase 2.6 — 3-Day Production Observation

## Purpose

Phase 2.5 hardened the acquisition engine (scheduler guardrails, graceful
worker shutdown, systemd) and deployed it to run continuously on the
production VPS. Before making any further tuning decisions (worker
concurrency, scheduler interval, `MAX_ACTIVE_JOBS`), this phase runs the
real system unattended for ~72 hours and records real data growth, job
throughput, and VPS resource usage — not synthetic benchmarks — so those
decisions are based on actual behavior on the actual 2 vCPU / 2GB RAM / 20GB
disk box.

## Architecture

```
systemd
├── crawler-scheduler.service   (unchanged, Phase 2.5)
├── crawler-worker.service      (unchanged, Phase 2.5)
├── system-metrics.service      (new)
│       │
│       ▼  every SYSTEM_METRICS_INTERVAL_SECONDS (default 300s)
│   services/crawler/monitoring/collector.py
│       │  /proc/stat, /proc/loadavg, /proc/meminfo, os.statvfs("/")
│       ▼
│   PostgreSQL: system_metrics table
│
└── aggregation.timer -> aggregation.service   (new, added after observation
        │                                       start -- see note below)
        ▼  every 15 minutes
   npm run aggregate -w @phoneintel/api  (apps/api/src/cli/aggregate.ts)
        │  full re-scan of phone_observations -> phone_identities/evidence
        ▼
   PostgreSQL
        │
        ▼
apps/api/src/routes/monitoring.ts  (GET /api/v1/monitoring/*)
        │
        ▼
apps/web/ "Vận hành" tab (auto-refreshes every 60s)
```

**Why `aggregation.timer` was added mid-observation**: the crawler pipeline
(`crawler-worker`/`crawler-scheduler`) writes `raw_documents` and
`phone_observations` continuously, and separately upserts `phone_numbers`
inline during extraction — but turning an observation into a
`phone_identities` row (the thing the "production" filter in
`callDirectoryExport.ts`, and therefore the dashboard's Data Growth
numbers, actually reads) was still the Phase 1 manual step
(`npm run aggregate`), never wired into the continuous pipeline. Without
it, the dashboard's "Data Growth" section would have stayed flat for the
entire 72h regardless of how much real crawling happened. `aggregation.timer`
(systemd calendar timer, `OnUnitActiveSec=15min`) runs the existing,
unmodified `aggregate.ts` CLI on a schedule — no new code, no new
infrastructure, just automating a step that already existed. It's a
full re-scan of `phone_observations` each run (idempotent via the existing
`(phone_number_id, normalized_name, claim_source)` upsert key), which is
fine at current data volume (~10s per run).

No new infrastructure: same Postgres, same TS API, same static web app,
Python stdlib only for the collector (no psutil, no new dependency).

## What to observe

- **Data growth** — new production-eligible phone numbers per hour/day.
  "Production-eligible" is the *exact* rule `callDirectoryExport.ts`
  already uses for the live iOS export (`trust_level = 'HIGH'`, not a
  Fixture source, `phone_type` MOBILE/LANDLINE, identity not REJECTED) —
  see `docs/PHASE2_6_IMPLEMENTATION_PLAN.md` §2 for why this is the
  correct definition, traced through the schema, not guessed. Re-crawls of
  already-known numbers don't count (gated on `first_seen_at`, which is
  set once at INSERT and never updated).
- **Job throughput** — completed/failed counts over 1h/6h/24h, average job
  duration. Answers "is the worker keeping up."
- **Queue backlog** — pending count, oldest-pending age, derived
  HEALTHY/WARNING/CRITICAL status from `QUEUE_WARNING_PENDING_JOBS` /
  `QUEUE_CRITICAL_PENDING_JOBS` / `QUEUE_WARNING_AGE_MINUTES` /
  `QUEUE_CRITICAL_AGE_MINUTES` (`.env.example`).
- **CPU / RAM / Disk** — current + historical (bar-chart, 6h/24h/72h) from
  `system_metrics` snapshots.
- **Failures** — job failure counts feed directly into the same dashboard,
  no separate alerting system.

## How to access

Dashboard: **https://vn-phone.tuandv.id.vn** → "Vận hành" tab. Read-only,
no auth (same trust model as the rest of that public static site).

Raw API, if inspecting directly:
```bash
curl https://vn-phone.tuandv.id.vn/api/v1/monitoring/summary
curl "https://vn-phone.tuandv.id.vn/api/v1/monitoring/data-growth?window=72h"
curl "https://vn-phone.tuandv.id.vn/api/v1/monitoring/system-metrics?window=72h"
curl https://vn-phone.tuandv.id.vn/api/v1/monitoring/jobs
```

## How to check services

```bash
ssh pc1@103.163.216.32
sudo systemctl status crawler-scheduler crawler-worker system-metrics
sudo systemctl status aggregation.timer
sudo systemctl list-timers aggregation.timer
```

The first three should read `active (running)`; `aggregation.timer` reads
`active (waiting)` (timers are idle between fires by design) with
`list-timers` showing the next scheduled run.

## Logs

```bash
sudo journalctl -u system-metrics.service -f
sudo journalctl -u crawler-worker.service --since "1 hour ago"
sudo journalctl -u crawler-scheduler.service --since "1 hour ago"
```

## After 72 hours — evaluation checklist

Pull these directly from `GET /api/v1/monitoring/summary` and
`/system-metrics?window=72h` (don't eyeball the dashboard for the report —
query the API for exact numbers):

- [ ] Total new production phone numbers over the observation window
      (`data.added.observation`), and per-day rate.
- [ ] Total jobs completed / failed (sum `jobs.completed_24h` across the 3
      daily snapshots, or query `crawl_jobs` directly for the full window).
- [ ] Average job duration (`jobs.average_duration_seconds`) — stable, or
      trending up (would suggest growing per-page cost, not concurrency).
- [ ] Peak pending-job count and how long the queue stayed above the
      `QUEUE_WARNING_PENDING_JOBS` threshold, if ever — evidence for or
      against `WORKER_CONCURRENCY = 1` being sufficient.
- [ ] Peak and average CPU/RAM from `system_metrics` over the full 72h —
      evidence for or against CPU/RAM being the bottleneck vs. network/
      target-site latency.
- [ ] Disk growth: `disk_available_bytes` at observation start vs. end —
      evidence for or against disk being a medium-term constraint.
- [ ] Worker restart count: **not recorded anywhere** — systemd's own
      restart counter is process-local and resets on `daemon-reload` or
      reboot, and nothing in this phase queries or persists it. If this
      number is needed, add it explicitly rather than inferring it from
      absence of evidence.

Decisions this feeds, per the original spec's framing: whether to raise
`WORKER_CONCURRENCY` beyond 1 (only justified if CPU/RAM stayed low while
jobs backed up — i.e., the bottleneck was idle-worker-waiting, not
resource exhaustion), whether `SCHEDULER_INTERVAL_SECONDS`/
`MAX_ACTIVE_JOBS` need retuning, and whether disk growth needs addressing
before the next multi-day run.

## Non-goals (unchanged from the spec)

No Prometheus/Grafana/ELK/InfluxDB/Kubernetes/APM/alerting/auto-scaling.
Snapshots every 5 minutes, not every second. This document and the
dashboard are the entire "monitoring platform" — intentionally.
