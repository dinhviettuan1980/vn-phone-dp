#!/usr/bin/env bash
# Seeds the dev database by running the REAL pipeline against the local
# fixture HTTP server (not static INSERTs) — crawl -> extract -> normalize
# -> aggregate. Produces >= 10 raw_documents, >= 50 observations,
# >= 20 unique phone numbers per docs/architecture.md's fixture set.
#
# Usage: DATABASE_URL=... FIXTURES_BASE_URL=... ./scripts/seed.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DATABASE_URL="${DATABASE_URL:-postgres://phoneintel:phoneintel@localhost:55432/phoneintel}"
export FIXTURES_BASE_URL="${FIXTURES_BASE_URL:-http://localhost:8899}"

echo "[seed] applying migration..."
psql "$DATABASE_URL" -f "$ROOT_DIR/database/migrations/0001_init.sql"

echo "[seed] crawling fixture sources (expects fixture server running on $FIXTURES_BASE_URL)..."
(cd "$ROOT_DIR/services/crawler" && python -m jobs.crawl_worker --source all)

echo "[seed] running aggregation..."
(cd "$ROOT_DIR" && npm run aggregate -w @phoneintel/api)

echo "[seed] done."
