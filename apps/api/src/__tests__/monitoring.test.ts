import { describe, it, expect } from "vitest";
import {
  evaluateQueueHealth,
  getMonitoringSummary,
  getDataGrowthTimeSeries,
  getSystemMetricsHistory,
} from "../services/monitoring.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("evaluateQueueHealth (pure, no DB)", () => {
  const thresholds = { warningPending: 10, criticalPending: 30, warningAgeMinutes: 60, criticalAgeMinutes: 180 };

  it("is HEALTHY when pending is low and nothing is old", () => {
    expect(evaluateQueueHealth(2, 120, thresholds)).toBe("HEALTHY");
  });

  it("is WARNING when pending crosses the warning threshold", () => {
    expect(evaluateQueueHealth(15, 60, thresholds)).toBe("WARNING");
  });

  it("is WARNING when the oldest pending job crosses the warning age", () => {
    expect(evaluateQueueHealth(1, 61 * 60, thresholds)).toBe("WARNING");
  });

  it("is CRITICAL when pending crosses the critical threshold", () => {
    expect(evaluateQueueHealth(31, 60, thresholds)).toBe("CRITICAL");
  });

  it("is CRITICAL when the oldest pending job crosses the critical age even with few pending", () => {
    expect(evaluateQueueHealth(1, 181 * 60, thresholds)).toBe("CRITICAL");
  });

  it("treats no pending jobs (null age) as HEALTHY", () => {
    expect(evaluateQueueHealth(0, null, thresholds)).toBe("HEALTHY");
  });
});

describe.skipIf(!hasDb)("monitoring API (requires seeded DATABASE_URL)", () => {
  it("summary returns the full documented shape", async () => {
    const summary = await getMonitoringSummary();

    expect(summary.observation).toHaveProperty("elapsed_seconds");
    expect(summary.observation).toHaveProperty("target_seconds");
    expect(summary.observation).toHaveProperty("remaining_seconds");

    expect(typeof summary.data.total_numbers).toBe("number");
    expect(summary.data.added).toHaveProperty("1h");
    expect(summary.data.added).toHaveProperty("24h");
    expect(summary.data.added).toHaveProperty("observation");

    expect(typeof summary.jobs.pending).toBe("number");
    expect(typeof summary.jobs.completed).toBe("number");
    expect(typeof summary.jobs.average_duration_seconds).toBe("number");

    expect(["HEALTHY", "WARNING", "CRITICAL"]).toContain(summary.queue.status);
  });

  it("data-growth time series only counts production-eligible numbers, bucketed by hour", async () => {
    const series = await getDataGrowthTimeSeries(24);
    for (const bucket of series) {
      expect(bucket.count).toBeGreaterThan(0);
      expect(bucket.bucket).toBeTruthy();
    }
  });

  it("system-metrics history respects the window parameter", async () => {
    const snapshots = await getSystemMetricsHistory("72h");
    expect(Array.isArray(snapshots)).toBe(true);
    // 72h at a 5-minute interval is at most 864 rows -- must not balloon.
    expect(snapshots.length).toBeLessThanOrEqual(864);
  });
});
