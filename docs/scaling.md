# Scaling roadmap

Phase 1 is intentionally not built for scale — it's built to not paint
itself into a corner. Nothing below is implemented yet; this is the plan for
when observation volume outgrows the current design.

## Phase 1 (current): up to ~100K observations

- Single PostgreSQL instance, `raw_content` inline as `TEXT`.
- Crawl queue = `crawl_targets` table, single worker process
  (`jobs/crawl_worker.py`), sequential per source.
- Aggregation = one full pass over `phone_observations` per invocation
  (`npm run aggregate`), fine at this volume (seconds, not minutes).
- No caching layer — the API queries Postgres directly per request.

## Phase 2: ~1M–10M observations

- **Raw storage**: move `raw_documents.raw_content` behind object storage
  (S3/MinIO). Add a `storage_ref` column alongside (or instead of)
  `raw_content`; the column was isolated on its own table in phase 1
  specifically so this migration doesn't touch `phone_observations` or
  anything downstream.
- **Batch processing**: aggregation stops being "reprocess everything every
  time" and becomes incremental — track a high-water mark (e.g.
  `phone_observations.id` or `discovered_at`) and only aggregate
  observations newer than the last run, falling back to a full
  re-aggregation only when the scoring rules themselves change.
- **Worker concurrency**: multiple crawler worker processes pulling from
  `crawl_targets` via `SELECT ... FOR UPDATE SKIP LOCKED`, still on
  Postgres — no broker needed yet, just multi-consumer-safe polling.
- **Partitioning**: partition `phone_observations` and `raw_documents` by
  `discovered_at`/`fetched_at` (monthly range partitions) once table size
  makes sequential scans or vacuum a problem.
- **Read path**: add a cache (Redis) in front of `GET /api/v1/phones/:phone`
  for hot lookups; the underlying query stays the source of truth.

## Phase 3: 100M+ observations

- **Distributed workers**: crawler becomes multiple independent processes
  (or containers) per source group, coordinated through the same
  `crawl_targets` table or, if contention becomes a real bottleneck,
  a message queue (Kafka/Redis Streams) — only justified once a single
  Postgres-backed queue demonstrably can't keep up.
- **Analytical workload split**: `phone_observations` and
  `phone_identity_evidence` at this scale are append-heavy and rarely
  updated — a good candidate for moving read-heavy analytics (data quality
  reports, top-sources dashboards) onto a columnar/analytical store
  (e.g. ClickHouse) fed by CDC from Postgres, while Postgres stays the
  transactional source of truth for the lookup API.
- **Object storage is mandatory** at this point, not optional — inline raw
  content in Postgres stops being viable long before 100M rows.
- **Entity resolution engine**: the rule-based aggregation in
  `services/aggregation.ts` (`claim_source = 'rule_based_aggregation_v1'`)
  gets replaced or supplemented by a proper entity-resolution / LLM
  enrichment pass, versioned under a different `claim_source` so historical
  claims remain queryable and comparable (see `docs/architecture.md`).

## What we deliberately did NOT build in phase 1

- Kubernetes, microservices — a single API + a single crawler process is
  enough until throughput data says otherwise.
- Kafka/BullMQ — see "Job queue" decision in `docs/architecture.md`.
- Sharding/partitioning — premature at 100K rows; the migration path above
  exists specifically so this can be added later without a schema rewrite.
