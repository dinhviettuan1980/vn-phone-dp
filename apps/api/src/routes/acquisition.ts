import type { FastifyInstance } from "fastify";
import { listJobs, getJob, getAcquisitionStats, getSourcePerformance, enqueueDomainDiscovery } from "../services/acquisition.js";
import { getJobStats } from "../services/jobStats.js";
import { getUnknownNumbersPriority } from "../services/callLog.js";

export async function acquisitionRoutes(app: FastifyInstance) {
  app.post<{ Body: { domain: string; source_name?: string } }>("/api/v1/discovery/domain", async (request, reply) => {
    const { domain, source_name } = request.body;
    if (!domain) {
      return reply.status(400).send({ error: "domain is required" });
    }
    const jobId = await enqueueDomainDiscovery(domain, source_name);
    return reply.send({ job_id: jobId, status: "PENDING" });
  });

  app.get<{ Querystring: { status?: string; job_type?: string; limit?: string } }>("/api/v1/acquisition/jobs", async (request, reply) => {
    const limit = request.query.limit ? Number(request.query.limit) : 50;
    const jobs = await listJobs(request.query.status, request.query.job_type, limit);
    return reply.send({ jobs, count: jobs.length });
  });

  app.get<{ Params: { id: string } }>("/api/v1/acquisition/jobs/:id", async (request, reply) => {
    const job = await getJob(request.params.id);
    if (!job) return reply.status(404).send({ error: "job not found" });
    return reply.send(job);
  });

  app.get("/api/v1/acquisition/stats", async (_request, reply) => {
    const stats = await getAcquisitionStats();
    return reply.send(stats);
  });

  app.get("/api/v1/acquisition/job-stats", async (_request, reply) => {
    const stats = await getJobStats();
    return reply.send(stats);
  });

  app.get<{ Params: { id: string } }>("/api/v1/sources/:id/performance", async (request, reply) => {
    const performance = await getSourcePerformance(request.params.id);
    if (!performance) return reply.status(404).send({ error: "source not found" });
    return reply.send(performance);
  });

  app.get("/api/v1/unknown-numbers/priority", async (_request, reply) => {
    const entries = await getUnknownNumbersPriority();
    return reply.send({
      entries: entries.map((e) => ({
        phone: e.phoneNormalized ?? e.phoneRaw,
        call_count: e.totalCalls,
        days_called: e.daysCalled,
        last_seen_at: e.lastCallDate,
        priority_score: e.priorityScore,
      })),
    });
  });
}
