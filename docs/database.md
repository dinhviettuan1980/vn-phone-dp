# Database

Schema: `database/migrations/0001_init.sql`. Applied automatically by the
`postgres` container on first boot (mounted at
`/docker-entrypoint-initdb.d`), or manually via `psql "$DATABASE_URL" -f
database/migrations/0001_init.sql`.

## Tables

| Table | Purpose | Mutability |
|---|---|---|
| `data_sources` | Source registry — one row per crawlable source | `crawl_policy`/`trust_level` updatable; rows otherwise stable |
| `crawl_targets` | URL job queue (Postgres-backed) | `crawl_status`/`attempt_count`/`content_hash` updated per attempt |
| `raw_documents` | Immutable raw HTML + metadata | **Insert-only.** A changed page = a new row, never an update |
| `phone_observations` | One row per phone sighting | **Insert-only.** Never deduped, never merged |
| `phone_numbers` | Canonical E.164 identity | `observation_count`/`last_seen_at` incremented on new observations |
| `phone_identities` | Identity claims (name/type/category/confidence) | Upserted per `(phone_number_id, normalized_name, claim_source)` |
| `phone_identity_evidence` | Links a claim to the observations that support it | **Insert-only** (append evidence as it's found) |

## Why `raw_documents` isn't behind object storage yet

`raw_content` is a plain `TEXT` column in phase 1 — inline in Postgres.
That's deliberate: at 100K observations the data fits comfortably and it
keeps the stack to one moving part (see `docs/scaling.md` for the phase 2/3
plan to move this behind S3/MinIO with a `storage_ref` column instead). The
column is isolated on its own table specifically so that migration doesn't
touch any other table's shape.

## Indexing rationale

| Index | Why |
|---|---|
| `phone_numbers(phone_e164)` UNIQUE | Canonical identity lookup is the API's hottest path (`GET /api/v1/phones/:phone`) |
| `phone_observations(phone_normalized)` | Aggregation groups observations by normalized phone |
| `phone_observations(raw_document_id)` | Idempotency check — "does this document already have observations" |
| `crawl_targets(normalized_url)` UNIQUE | Prevents duplicate queue entries for the same URL in different forms |
| `raw_documents(content_hash)` | Duplicate-content detection for the data-quality `duplicate_content_ratio` metric |
| `phone_identities(phone_number_id)` | Lookup API pulls all identities for a phone |
| `phone_identities(phone_number_id, normalized_name, claim_source)` UNIQUE | Makes aggregation idempotent per claim engine — see `docs/architecture.md` |
| `phone_identity_evidence(phone_identity_id)` | Evidence-summary queries per identity |
| `phone_identity_evidence(phone_identity_id, phone_observation_id)` UNIQUE | Prevents the same observation being linked twice to one identity on re-aggregation |
| `data_sources(name)` UNIQUE | Source registry upsert key — `sources.yaml` is config-driven, keyed by name |

## Enums

`source_type`, `trust_level`, `crawl_status`, `phone_type`, `identity_type`,
`identity_category`, `identity_status` are all native Postgres enums rather
than free-text columns — the values are a fixed, documented vocabulary (see
`packages/shared-types/src/index.ts` for the TypeScript mirror), and an enum
makes an invalid value a write-time error instead of a silent data-quality
problem discovered later in aggregation.
