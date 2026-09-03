# IMPLEMENTATION_PLAN.md — Vietnam Phone Intelligence Data Platform (Phase 1)

## 1. Goal

Build the foundation of a phone-number intelligence database: raw evidence in,
lookup-ready intelligence out, with full provenance at every step. Not a CRUD
app, not a Caller ID app — a data pipeline with an API on top.

## 2. Architecture (7 layers)

```
SOURCE REGISTRY  →  RAW ACQUISITION  →  RAW EVIDENCE (immutable)
   →  PHONE EXTRACTOR (regex + context)  →  PHONE OBSERVATION
   →  PHONE NORMALIZER  →  PHONE NUMBER (canonical identity)
   →  INTELLIGENCE AGGREGATION (rule-based)  →  LOOKUP API
```

Each layer only appends. Nothing overwrites raw data. Every identity claim
carries a link back to the observation(s) that produced it.

## 3. Tech decisions (see docs/architecture.md for full rationale)

- API: Node 20 + TypeScript + Fastify
- ORM/query layer: **Drizzle** (not Prisma) — no query-engine binary, low
  memory footprint, works well on a small VPS, SQL stays close to the surface
  which matters for a data-heavy platform. Migrations authored as plain SQL
  in `database/migrations/`, mirrored as a Drizzle schema for type-safe
  queries in the API.
- Crawler: Python 3.12, httpx + BeautifulSoup4, no Playwright in phase 1.
- Job/queue: **Postgres table** (`crawl_targets.crawl_status`), no Redis/BullMQ
  yet — crawl volume in phase 1 doesn't justify a broker.
- Infra: Docker Compose (postgres, api, crawler). No Kubernetes.
- Demo acquisition target: a local static-fixture HTTP server
  (`services/crawler/tools/serve_fixtures.py`) simulating 3 real sources
  (official org, business directory, low-trust blog) with a `robots.txt`.
  This lets the crawler run a real HTTP crawl end-to-end without touching
  any live external website — safer and fully reproducible for anyone who
  clones the repo.

## 4. Ethics/privacy guardrail (decision, documented here because it shapes scope)

Phase 1 sources are restricted to official/organizational/business-directory
content. The `data_sources.trust_level` + `license_notes` + `crawl_policy`
fields are mandatory, not decorative. Real-world expansion to forums,
classifieds, or social content would start picking up personal (not just
business) phone numbers, which triggers Vietnam's Decree 13/2023 on personal
data protection (consent/lawful-basis requirements) — that expansion is
explicitly out of scope for phase 1 and flagged in `docs/architecture.md` so
it isn't done silently later.

## 5. Steps

1. ~~Analyze requirements~~ (this doc)
2. ~~Propose architecture~~ (this doc + docs/architecture.md)
3. Database schema — `database/migrations/0001_init.sql`
4. Project scaffolding — package.json/tsconfig/docker-compose/pyproject
5. Drizzle schema mirroring the SQL migration (`apps/api/src/db/schema.ts`)
6. `VietnamPhoneNormalizer` (TS, used by API) + Python port (used by crawler) + unit tests
7. Phone extraction pipeline (regex + context window), TS + Python
8. Crawler framework (base collector → http collector → source configs → postgres repository → crawl worker) + fixture sources
9. Rule-based aggregation engine (observations → phone_identities + evidence)
10. Fastify API: `/api/v1/phones/:phone`, `/search`, `/stats`, `/sources`
11. Seed: fixture HTTP server + 3 sources + crawl targets + sources.yaml
12. Tests: unit (normalizer, extractor) + integration (crawl→raw→observation→normalize→aggregate→API)
13. Docs: `docs/architecture.md`, `docs/database.md`, `docs/scaling.md`, `README.md`

## 6. Definition of done (from spec)

`docker compose up` → seed → crawl (real HTTP against fixtures) → raw_documents
stored → phones extracted → normalized to E.164 → same number from multiple
fixture pages produces multiple observations → aggregation produces
candidate identities → `GET /api/v1/phones/0912345678` returns canonical
phone, type, observation/source counts, identity candidates with confidence,
evidence summary.
