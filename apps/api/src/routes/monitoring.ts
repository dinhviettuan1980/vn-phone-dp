import type { FastifyInstance } from "fastify";
import {
  getMonitoringSummary,
  getDataGrowthTimeSeries,
  getSystemMetricsHistory,
  getRunningJobs,
} from "../services/monitoring.js";

export async function monitoringRoutes(app: FastifyInstance) {
  app.get("/api/v1/monitoring/summary", async (_request, reply) => {
    const summary = await getMonitoringSummary();
    return reply.send(summary);
  });

  app.get<{ Querystring: { window?: string } }>("/api/v1/monitoring/data-growth", async (request, reply) => {
    const windowHours = request.query.window === "72h" ? 72 : 24;
    const series = await getDataGrowthTimeSeries(windowHours);
    return reply.send({ window: `${windowHours}h`, series });
  });

  app.get<{ Querystring: { window?: string } }>("/api/v1/monitoring/system-metrics", async (request, reply) => {
    const window = request.query.window ?? "24h";
    const snapshots = await getSystemMetricsHistory(window);
    return reply.send({ window, snapshots });
  });

  app.get("/api/v1/monitoring/jobs", async (_request, reply) => {
    const running = await getRunningJobs();
    return reply.send({ running });
  });
}
