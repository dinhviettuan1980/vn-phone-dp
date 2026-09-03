# Vietnam Phone Intelligence Data Platform (Phase 1)

A data platform, not a CRUD app. The asset is the **phone intelligence
database + raw evidence + provenance** — not a UI. See
`IMPLEMENTATION_PLAN.md` for scope and `docs/architecture.md` for design
decisions (start there if you're wondering "why is X built this way").

```
SOURCE REGISTRY -> RAW ACQUISITION -> RAW EVIDENCE (immutable)
   -> PHONE EXTRACTOR -> PHONE OBSERVATION -> PHONE NORMALIZER
   -> PHONE NUMBER (canonical) -> INTELLIGENCE AGGREGATION -> LOOKUP API
```

Raw data is never overwritten. A phone number can have many observations
across many sources, and many (possibly conflicting) identity claims — see
`docs/architecture.md` for why.

## Stack

- **API**: Node 20, TypeScript, Fastify, Drizzle ORM over Postgres
- **Crawler**: Python 3.12, httpx + BeautifulSoup4 (no Playwright)
- **DB**: PostgreSQL (raw SQL migrations in `database/migrations/`)
- **Infra**: Docker Compose — `postgres`, `api`, `crawler`, `fixtures`

## Quick start (Docker)

```bash
docker compose up -d postgres fixtures
docker compose run --rm crawler python -m jobs.crawl_worker --source all
docker compose up -d api
docker compose run --rm api npm run aggregate -w @phoneintel/api
curl http://localhost:3000/api/v1/phones/0912345678
```

The `fixtures` service serves 3 synthetic sources (official org, business
directory, low-trust blog — entirely fake data) over real HTTP so the
crawler exercises real robots.txt/rate-limit/retry logic without touching
any live external website. See `docs/architecture.md`.

## Quick start (local dev, no Docker, no local Postgres)

There's a dedicated dev Postgres already running on the VPS
(`103.163.216.32`, database `phoneintel`) — no need to run Postgres locally
or via Docker for day-to-day API development. Credentials are in the
project's `.env` (gitignored). See `docs/architecture.md` for how it's
firewalled (scoped to a specific dev IP, not open to the internet).

```bash
# 1. DATABASE_URL already points at the remote dev DB via .env — just load it
export $(grep -v '^#' .env | xargs)
psql "$DATABASE_URL" -f database/migrations/0001_init.sql   # already applied once, safe to skip

# 2. install deps
npm install
(cd services/crawler && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt)

# 3. start the fixture server (separate terminal)
(cd services/crawler && source .venv/bin/activate && python tools/serve_fixtures.py)

# 4. run the pipeline
export DATABASE_URL FIXTURES_BASE_URL=http://localhost:8899
./scripts/seed.sh          # crawl + aggregate (see database/seed/README.md)

# 5. run the API
npm run dev -w @phoneintel/api
curl http://localhost:3000/api/v1/phones/0912345678
```

## CLI commands

| Command | What it does |
|---|---|
| `python -m jobs.crawl_worker --source all` | Crawl every active source (idempotent) |
| `python -m jobs.crawl_worker --source "Fixture Official Org"` | Crawl one source |
| `python -m jobs.crawl_worker --normalize-only` | Re-run extraction on any raw_documents missing observations |
| `npm run aggregate -w @phoneintel/api` | Rule-based aggregation: observations -> identity candidates |
| `npm run stats -w @phoneintel/api` | Data quality metrics (Node CLI) |
| `python -m tools.data_stats` (from `services/crawler`) | Same metrics, spec's example CLI shape |

## API

Base path `/api/v1`.

- `GET /phones/:phone` — canonical phone + type, observation/source counts, identity candidates with confidence and evidence count
- `GET /phones/search?q=0912` — partial national-number search
- `GET /stats` — data quality metrics
- `GET /sources` — per-source raw_document/observation counts

## Testing

```bash
npm run test -w @phoneintel/api      # normalizer + extractor unit tests + integration (needs seeded DATABASE_URL)
(cd services/crawler && source .venv/bin/activate && python -m pytest)  # Python normalizer + extractor unit tests
```

The integration suite (`apps/api/src/__tests__/integration.pipeline.test.ts`)
asserts against a database that's already been through the real pipeline —
run `./scripts/seed.sh` first. It's skipped automatically if `DATABASE_URL`
isn't set.

## Repo layout

```
apps/api/              Fastify API, Drizzle schema, normalizer, extractor, aggregation, CLI
services/crawler/       Python crawler framework + fixtures + tests
packages/shared-types/  TS types shared conceptually across API/crawler (crawler mirrors independently)
database/migrations/    SQL schema (source of truth)
database/seed/          Seed pipeline docs (no static INSERT files — see database/seed/README.md)
docs/                   architecture.md, database.md, scaling.md
scripts/seed.sh         Orchestrates crawl + aggregate against the fixture sources
```

## Adding a real source

Add an entry to `services/crawler/config/sources.yaml` — no core code
changes needed for a source that just needs the generic HTTP collector. See
`collectors/sources/example_official.py` for where source-specific parsing
overrides go if a site's markup needs it. Read the privacy/scope note in
`docs/architecture.md` before adding anything beyond
official/business-directory/government sources.
