import type { FastifyInstance } from "fastify";
import { getCallDirectoryEntries, getBlockedDigits } from "../services/callDirectoryExport.js";

export async function callDirectoryRoutes(app: FastifyInstance) {
  app.get("/api/v1/export/call-directory", async (_request, reply) => {
    const [entries, blockedDigits] = await Promise.all([getCallDirectoryEntries(), getBlockedDigits()]);
    return reply.send({ entries, blocked_digits: blockedDigits, count: entries.length });
  });
}
