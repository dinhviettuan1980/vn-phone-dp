# Phase 2 Implementation Plan — Data Acquisition Engine

## 1. Current state (Phase 1, verified by re-reading the repo before writing this)

### Architecture recap
```
sources.yaml -> upsert data_sources -> crawl_targets (1 row/URL, priority INT already exists)
   -> HttpCollector.fetch() -> raw_documents (immutable, content_hash-deduped)
   -> extract_phone_candidates_from_html() -> phone_observations
   -> normalize_vietnam_phone() -> phone_numbers (canonical, upserted)
   -> runAggregation() (TS) -> phone_identities + phone_identity_evidence
   -> Fastify API -> /export/call-directory -> iOS CallKit extension
```

### Reusable components (Phase 2 must call these, not reimplement)
- `services/crawler/collectors/http/http_collector.py::HttpCollector` — robots.txt-aware fetch (own UA, not Python's default — see `docs/architecture.md`), per-domain rate limiting, retry/backoff. **Extending**, not replacing: adding conditional-request support (ETag/Last-Modified) for Part G.
- `services/crawler/storage/postgres_repository.py` — all SQL for the raw pipeline. **Extending** with new functions for jobs/datasets/discovery, same module, same connection pattern (`psycopg`, `dict_row`).
- `services/crawler/extractors/phone_extractor.py::extract_phone_candidates_from_html` — reused verbatim by dataset ingestion's row processor is NOT applicable (dataset phone values are already structured, not regex-extracted from HTML) but IS reused by any future HTML-based discovery target.
- `services/crawler/normalizers/vietnam_phone.py::normalize_vietnam_phone` — reused verbatim by dataset ingestion.
- `services/crawler/jobs/crawl_worker.py::extract_and_store_observations` — reused verbatim by the new worker's `CRAWL_URL`/`CRAWL_SOURCE` job handlers (imported, not copied).
- `crawl_targets` table already has `priority INTEGER`, `next_crawl_at`, `content_hash`, `crawl_status` — **this is already the "URL queue"** the spec asks for. Domain discovery inserts into this table via the existing `upsert_crawl_target`; no new "discovered_urls" table needed.
- `apps/api/src/services/stats.ts` — existing data-quality metrics; Part L/M metrics extend this file rather than creating a parallel metrics module.
- `personal_call_logs` (added this session, before Phase 2 was requested) — already exactly the "unknown number" raw material Part K asks for. No new ingestion path needed for it.

### Gaps (why Phase 2 is needed)
1. Crawling is 100% manual (`python -m jobs.crawl_worker --source "<name>"` run by hand over SSH). No queue, no scheduler, no worker concurrency safety.
2. `sources.yaml` URLs are hand-curated one at a time (this session added ~36 institutions by manual web search). No mechanism discovers new URLs from a domain automatically.
3. No sitemap support at all.
4. No URL scoring — every URL in `sources.yaml` is trusted by construction (a human picked it).
5. Incremental crawling exists only via full-content-hash comparison (already good — see `docs/architecture.md`), not conditional HTTP requests, so an unchanged page still costs a full GET.
6. No bulk dataset ingestion (CSV/XLSX/JSON) — every phone number in the DB so far came from live HTML crawling.
7. `personal_call_logs`/unknown-numbers has no priority scoring or dedicated API surface beyond the simple `/call-logs/unknown` list (sorted by call count only, no recency/repeat weighting).
8. No acquisition-level metrics (jobs succeeded/failed, discovery counts, per-source yield) — only data-quality metrics (`/api/v1/stats`) exist.

## 2. Phase 2 architecture (delta only)

```
                    DATA SOURCE REGISTRY (existing data_sources, extended)
                                |
                +---------------+----------------+
                |                                |
                v                                v
        DOMAIN DISCOVERY                 DATASET INGESTION
     (new: domain_discovery/)         (new: dataset_ingestion/)
                |                                |
                v                                v
     sitemap fetch+parse+score          CSV/XLSX/JSON -> rows
                |                                |
                v                                v
     crawl_targets (EXISTING TABLE,       raw_documents (EXISTING TABLE,
     reused, priority = URL score)        one per row) -> phone_observations
                |                          (via EXISTING extract/normalize)
                v
          crawl_jobs (NEW QUEUE TABLE)
                |
                v
     worker.py claims job (FOR UPDATE SKIP LOCKED)
                |
                v
     dispatches to EXISTING crawl_worker.extract_and_store_observations
                |
                v
     EXISTING normalization -> EXISTING aggregation -> EXISTING API/iOS
```

Nothing after "raw_documents" changes. Phase 2 is entirely upstream of the
Phase 1 pipeline, exactly as the spec requires.

## 3. Database changes (new migration `0003_acquisition_engine.sql`, additive only)

- **`crawl_jobs`** (new) — the job queue, fields per spec.
- **`datasets`** (new) — provenance for bulk-ingested files, per spec.
- **`domain_discoveries`** (new, not in spec's explicit list but needed for
  Part L "domains_discovered / sitemaps_discovered / urls_discovered"
  metrics — one row per discovery run, not per URL, so it's cheap).
- **`data_sources`**: add `crawl_frequency` (text: `DAILY`/`WEEKLY`/`MONTHLY`,
  configurable per spec Part B, default `WEEKLY`), `next_scheduled_at`
  timestamptz — drives the scheduler's source-level discovery cadence.
  Additive `ALTER TABLE`, no existing column touched.
- **`crawl_targets`**: add `etag`, `last_modified` (text, nullable) for
  conditional requests. Additive.

No existing table's existing columns are altered or dropped. `priority`
already existed on `crawl_targets` — reused for URL relevance score
directly, per "REUSE > REWRITE."

## 4. New modules

```
services/crawler/
  domain_discovery/
    __init__.py
    domain_normalizer.py      # https://Example.vn/ -> https://example.vn
    sitemap_discoverer.py     # robots.txt Sitemap: lines + common paths fallback
    sitemap_parser.py         # <urlset>, <sitemapindex> (recursive, MAX_DEPTH), gzip
    url_scorer.py             # config-driven keyword scoring (url_scoring.yaml)
    discovery_service.py      # orchestrates the above, writes crawl_targets + domain_discoveries
  dataset_ingestion/
    __init__.py
    base_ingestor.py          # BaseDatasetIngestor ABC: validate/read_rows/process
    csv_ingestor.py
    xlsx_ingestor.py
    json_ingestor.py
    column_detector.py        # config-driven aliases (phone_column_aliases.yaml)
    row_processor.py          # row -> raw_document -> phone_observation (reuses normalizer)
    dataset_service.py        # orchestrates: pick ingestor, create datasets row, iterate rows
  jobs/
    queue.py                  # crawl_jobs create/claim/complete/fail/recover_stale
    worker.py                 # claim loop, dispatch by job_type
    scheduler.py               # single-pass: due crawl_targets -> CRAWL_URL jobs, due sources -> DISCOVER_DOMAIN jobs
  cli/
    discover_domain.py
    ingest_dataset.py
  config/
    url_scoring.yaml
    phone_column_aliases.yaml

apps/api/src/
  services/acquisition.ts     # jobs list/detail, stats, source performance, unknown-number priority
  routes/acquisition.ts
```

## 5. Migration strategy

Single additive migration, applied the same way as `0002_...` (`psql -f`
against the VPS DB, no downtime — new tables, new nullable columns on
existing tables). No backfill needed: `crawl_jobs` starts empty,
`data_sources.crawl_frequency` defaults to `WEEKLY` for all 36 existing
rows via `DEFAULT`, `crawl_targets.etag`/`last_modified` start `NULL` (first
crawl of each still does a full GET, exactly like today).

## 6. Implementation steps

Follow the spec's STEP 3–20 order. Discovery and dataset ingestion are
independently testable before wiring into the job queue, so build
bottom-up: queue -> worker -> scheduler -> discovery -> scoring -> wire
discovery into queue -> incremental headers -> dataset ingestion -> wire
into evidence pipeline -> unknown-number priority -> metrics -> API -> CLI
-> tests -> docs.

## 7. Risks

- **Job queue correctness under concurrency** — mitigated with
  `SELECT ... FOR UPDATE SKIP LOCKED`, the standard Postgres pattern for
  this; single-VPS/single-worker-process deployment in phase 2 makes this
  low-risk in practice, but implemented correctly for when a second worker
  is added.
- **Sitemap parsing on malformed/huge XML** — cap with `MAX_DEPTH` for
  nested sitemap indexes (per spec) and a max-URLs-per-domain limit to
  avoid one huge sitemap flooding `crawl_targets` with low-value URLs
  before scoring has a chance to filter them.
- **Dataset ingestion trust** — a CSV/XLSX/JSON file has no robots.txt
  equivalent; provenance (`datasets.license_notes`, `source_id`) is
  mandatory at ingestion time, mirroring the existing
  `data_sources.license_notes` discipline from Phase 1.
- **Scope creep vs. the "don't rewrite Phase 1" instruction** — every new
  module in section 4 is additive; `crawl_worker.py`'s existing
  `crawl_source`/`extract_and_store_observations` functions are imported
  and reused by `jobs/worker.py`, not duplicated.

## 8. Testing strategy

- Unit tests (pure functions, no DB): sitemap parsing (flat/index/nested/
  gzip/invalid XML), URL scorer (high/medium/deny), column detector
  (phone/sdt/điện thoại/hotline aliases).
- Integration tests (require `DATABASE_URL`, same skip-if-unset pattern as
  the existing TS integration suite): job queue claim/retry/stale-recovery
  against the real dev DB; dataset ingestion end-to-end (CSV -> raw_document
  -> phone_observation -> normalized phone_number).
- Demo fixtures: extend `services/crawler/fixtures/` with a mock domain
  (robots.txt + sitemap index + nested sitemap + contact/branch/product/
  blog pages) to verify contact pages score higher than blog pages, and a
  sample `company_name,phone,address,category` CSV.
