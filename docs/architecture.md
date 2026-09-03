# Architecture

## Why not `phone -> name`

A naive design collapses everything into one row per phone number with a
single name/category. That destroys two things this platform is built
around: **provenance** (where did this claim come from?) and **conflict**
(what if two sources disagree?). Instead every layer only appends, and
identity is a *derived, evidence-backed claim*, never a fact overwritten in
place.

```
SOURCE REGISTRY (data_sources)
   |
   v
RAW ACQUISITION (crawler: collectors/*)
   |
   v
RAW EVIDENCE, immutable (raw_documents)
   |
   v
PHONE EXTRACTOR — regex + context window (extractors/phone_extractor)
   |
   v
PHONE OBSERVATION — one row per sighting, never deduped (phone_observations)
   |
   v
PHONE NORMALIZER — VietnamPhoneNormalizer (normalizers/vietnam_phone)
   |
   v
PHONE NUMBER — canonical E.164 identity (phone_numbers)
   |
   v
INTELLIGENCE AGGREGATION — rule-based, versioned claim_source (phone_identities + phone_identity_evidence)
   |
   v
LOOKUP API (Fastify, /api/v1/*)
```

Every `phone_identities` row links back to the exact `phone_observations`
rows that produced it via `phone_identity_evidence`. Re-running aggregation
never deletes a prior claim — the `(phone_number_id, normalized_name)`
unique index makes it an idempotent upsert, so the same name always resolves
to the same identity row, and conflicting names simply coexist as separate
rows with independent confidence scores.

## Decisions

### ORM: Drizzle over Prisma

Prisma ships a separate query-engine binary per platform and a generated
client — heavier to run and rebuild on a small VPS, and it fights a
data-heavy platform where you often want to drop to raw SQL (see
`services/stats.ts`, which mixes Drizzle queries with raw `pool.query`).
Drizzle is a thin type-safe layer over `pg`, no binary, no generation step.
Migrations are authored as plain SQL in `database/migrations/` (the source
of truth) and mirrored by hand in `apps/api/src/db/schema.ts` for
type-safe querying — small mirroring cost, but it keeps the schema
readable/reviewable as SQL rather than hidden behind a DSL, which matters
when the schema *is* the product.

### Job queue: a Postgres table, not Redis/BullMQ

`crawl_targets.crawl_status` is the queue. At phase-1 volume (tens of
thousands of URLs, not millions) a broker adds an operational dependency
without buying anything — Postgres already gives durability, and
`SELECT ... WHERE crawl_status = 'PENDING' ORDER BY next_crawl_at` is enough
to drive a single worker process. Revisit this in Phase 2/3 (see
`docs/scaling.md`) once worker concurrency needs real work distribution.

### Demo acquisition target: a local fixture server, not a live website

`services/crawler/tools/serve_fixtures.py` serves
`services/crawler/fixtures/` (3 simulated sources: an official org, a
business directory, a low-trust blog) over real HTTP on `:8899`, complete
with a `robots.txt`. The crawler makes genuine HTTP requests — real
rate-limiting, real robots.txt parsing, real retry/backoff — against this
server instead of any external site. This means `docker compose up` + seed
is 100% reproducible for anyone who clones the repo, and phase 1 never has
to make a judgment call about whether it's acceptable to crawl someone
else's live site as part of a demo.

### Two normalizer implementations, one spec

`apps/api/src/normalizers/vietnamPhone.ts` (API) and
`services/crawler/normalizers/vietnam_phone.py` (crawler) implement the same
rules independently — the crawler needs to normalize at extraction time
without a network round-trip to the API. Both are covered by parallel unit
test suites (30 TS cases, 30+ Python cases) asserting the same behavior, so
drift between them shows up as a test failure rather than silent
inconsistency. If this becomes a maintenance burden, the honest fix is
extracting a shared spec (e.g. a JSON rule table both sides load) — not
attempted in phase 1 because two carefully-tested small modules beat one
premature shared abstraction.

### Idempotency strategy

- A `raw_document` is only inserted when the fetched `content_hash` differs
  from the last one stored for that `crawl_target`. Unchanged page -> no-op.
- Extraction only runs once per `raw_document` (checked via
  "does this raw_document already have observations").
- `phone_identities` upserts on `(phone_number_id, normalized_name)`, so
  re-running aggregation updates confidence/evidence counts in place rather
  than duplicating identity rows.

Re-running `docker compose up` + the crawl + aggregate commands any number
of times converges to the same state, never duplicates.

## Remote dev database

Day-to-day API development connects straight to a Postgres instance on the
user's existing VPS (`103.163.216.32`, database `phoneintel`, role
`phoneintel_user`) instead of Docker or a local install — one less moving
part. Network access is scoped, not open to the internet:

- `pg_hba.conf` on the VPS has a `host phoneintel phoneintel_user
  <dev-IP>/32 scram-sha-256` rule — only that one source IP can authenticate
  as this role against this database. Every other database on that server
  is unaffected (default `pg_hba.conf` rules for other apps' local-only
  connections were untouched).
- `listen_addresses = '*'` was required for any remote connection to reach
  Postgres at all, but by itself doesn't widen *who* can connect — that's
  still gated by `pg_hba.conf` per above.
- No inbound firewall (`ufw`) was active on the VPS at setup time, so no
  firewall rule was needed to reach port 5432; if `ufw` is enabled later,
  the rule to add is `ufw allow from <dev-IP> to any port 5432 proto tcp`.
- If the dev machine's IP changes, the `pg_hba.conf` entry needs updating
  (and the server reloaded) or the connection will simply be refused —
  fails closed, not open.

Credentials live in `.env` (gitignored), not in this file or anywhere in
git history.

## Privacy / scope guardrail (read before adding sources)

Phase 1 sources (`config/sources.yaml`) are restricted to
official-organization, business-directory, and similar public/institutional
content — the fixture data in this repo is entirely synthetic (fake
company names, fake numbers), not scraped from any real site or person.

If a real deployment ever expands `sources.yaml` to forums, classifieds, or
social content, it will start picking up **personal** (not just business)
phone numbers alongside names — very common in Vietnamese real-estate and
marketplace listings. That triggers Vietnam's Decree 13/2023/NĐ-CP on
personal data protection, which requires a lawful basis (typically consent)
to process personal data. `data_sources.trust_level` +
`data_sources.license_notes` + `data_sources.crawl_policy` exist precisely
so that decision is visible and auditable per source, not made silently by
adding a URL to a config file. Expanding source scope should be a deliberate
decision recorded in this file, not a follow-on PR that just adds rows to
`sources.yaml`.

## Extension point for real intelligence

`services/aggregation.ts::runAggregation` is intentionally the simplest
thing that could work: regex-based name extraction + a fixed point-scoring
formula, tagged `claim_source = 'rule_based_aggregation_v1'`. Every
`phone_identities` row is versioned by `claim_source`, so a future
`claim_source = 'llm_enrichment_v1'` (or an entity-resolution engine) can
run *alongside* the rule-based one without touching existing rows — the
`(phone_number_id, normalized_name)` uniqueness is per claim, and nothing
stops two different `claim_source` values from coexisting for the same
phone. Raw observations are never discarded, so a smarter aggregator can
always be re-run from scratch over the exact same evidence.
