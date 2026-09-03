import type { FastifyInstance } from "fastify";
import { lookupPhone, searchPhones } from "../services/lookup.js";

export async function phoneRoutes(app: FastifyInstance) {
  app.get<{ Params: { phone: string } }>("/api/v1/phones/:phone", async (request, reply) => {
    const result = await lookupPhone(request.params.phone);
    return reply.send(result);
  });

  app.get<{ Querystring: { q?: string } }>("/api/v1/phones/search", async (request, reply) => {
    const q = request.query.q?.trim();
    if (!q) {
      return reply.status(400).send({ error: "missing_query_param_q" });
    }
    const results = await searchPhones(q);
    return reply.send({ query: q, results });
  });
}
