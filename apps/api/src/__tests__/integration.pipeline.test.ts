/**
 * End-to-end pipeline check: crawler -> raw_documents -> observations ->
 * normalization -> aggregation -> API lookup.
 *
 * This does not spin up its own database — it asserts against the output of
 * the real pipeline, matching the project's Definition of Done. Run first:
 *
 *   docker compose up -d postgres fixtures   (or the local-dev equivalent)
 *   psql "$DATABASE_URL" -f database/migrations/0001_init.sql
 *   python -m jobs.crawl_worker --source all   (from services/crawler, with FIXTURES_BASE_URL set)
 *   npm run aggregate -w @phoneintel/api
 *   npm run test -w @phoneintel/api
 *
 * Skipped automatically if DATABASE_URL isn't set, so it doesn't break
 * `npm test` in environments without the pipeline already run.
 */
import { describe, it, expect } from "vitest";
import { lookupPhone } from "../services/lookup.js";
import { getDataQualityStats } from "../services/stats.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("pipeline integration (requires seeded DATABASE_URL)", () => {
  it("resolves a multi-source phone with evidence-backed identities", async () => {
    const result = await lookupPhone("0912345678");

    expect(result.phone.normalized).toBe("+84912345678");
    expect(result.phone.type).toBe("MOBILE");
    expect(result.phone.valid).toBe(true);

    // Same number appeared on all 3 fixture sources in different formats.
    expect(result.statistics.observation_count).toBeGreaterThanOrEqual(5);
    expect(result.statistics.source_count).toBeGreaterThanOrEqual(2);

    // At least one identity claim should have resolved to the real company
    // name, not just "Unknown" — proves extraction -> normalization ->
    // aggregation carried context all the way through.
    const businessIdentity = result.identities.find((i) => i.type === "BUSINESS");
    expect(businessIdentity?.name).toContain("ABC");
    expect(businessIdentity?.evidence_count).toBeGreaterThan(0);
  });

  it("keeps conflicting identity claims separate instead of merging them", async () => {
    const result = await lookupPhone("0987654321");

    // This number is claimed as a legitimate insurance business on the
    // directory site AND flagged in spam/scam context on the blog — both
    // claims must survive as distinct identities, never silently merged.
    const names = result.identities.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length); // no duplicate identity rows
    expect(result.identities.length).toBeGreaterThanOrEqual(2);
  });

  it("returns a not-found shape for a phone that was never observed", async () => {
    const result = await lookupPhone("0909999999");
    expect(result.statistics.observation_count).toBe(0);
    expect(result.identities).toEqual([]);
  });

  it("data quality stats reflect the seeded pipeline output", async () => {
    const stats = await getDataQualityStats();
    expect(stats.total_raw_documents).toBeGreaterThanOrEqual(10);
    expect(stats.total_observations).toBeGreaterThanOrEqual(50);
    expect(stats.total_unique_phone_numbers).toBeGreaterThanOrEqual(20);
    expect(stats.top_sources_by_phone_count.length).toBeGreaterThan(0);
  });
});
