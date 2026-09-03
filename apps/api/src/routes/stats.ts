import type { FastifyInstance } from "fastify";
import { getDataQualityStats, getSourceStats } from "../services/stats.js";

export async function statsRoutes(app: FastifyInstance) {
  app.get("/api/v1/stats", async (_request, reply) => {
    const stats = await getDataQualityStats();
    return reply.send(stats);
  });

  app.get("/api/v1/sources", async (_request, reply) => {
    const sources = await getSourceStats();
    return reply.send({ sources });
  });
}
