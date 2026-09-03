import type { FastifyInstance } from "fastify";
import { getCallDirectoryEntries } from "../services/callDirectoryExport.js";

export async function callDirectoryRoutes(app: FastifyInstance) {
  app.get("/api/v1/export/call-directory", async (_request, reply) => {
    const entries = await getCallDirectoryEntries();
    return reply.send({ entries, count: entries.length });
  });
}
