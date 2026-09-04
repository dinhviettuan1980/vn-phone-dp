import type { FastifyInstance } from "fastify";
import { importCallLogEntries, getCallLogSummary, getUnknownNumbers } from "../services/callLog.js";

interface ImportBody {
  call_date: string;
  notes?: string;
  entries: Array<{ phone_raw: string; call_count?: number }>;
}

export async function callLogRoutes(app: FastifyInstance) {
  app.post<{ Body: ImportBody }>("/api/v1/call-logs/import", async (request, reply) => {
    const { call_date, notes, entries } = request.body;

    if (!call_date || !/^\d{4}-\d{2}-\d{2}$/.test(call_date)) {
      return reply.status(400).send({ error: "call_date must be YYYY-MM-DD" });
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return reply.status(400).send({ error: "entries must be a non-empty array" });
    }

    const results = await importCallLogEntries(
      call_date,
      entries.map((e) => ({ phoneRaw: e.phone_raw, callCount: e.call_count })),
      notes
    );

    return reply.send({
      imported: results.length,
      known: results.filter((r) => r.known).length,
      unknown: results.filter((r) => !r.known).length,
      results,
    });
  });

  app.get<{ Querystring: { from?: string; to?: string } }>("/api/v1/call-logs/summary", async (request, reply) => {
    const to = request.query.to ?? new Date().toISOString().slice(0, 10);
    const from = request.query.from ?? "2000-01-01";
    const rows = await getCallLogSummary(from, to);
    return reply.send({ from, to, entries: rows });
  });

  app.get("/api/v1/call-logs/unknown", async (_request, reply) => {
    const rows = await getUnknownNumbers();
    return reply.send({ entries: rows });
  });
}
