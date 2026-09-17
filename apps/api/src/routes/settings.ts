import type { FastifyInstance } from "fastify";
import { suppressNumber, unsuppressNumber, isSuppressed, listSuppressions } from "../services/labelSuppressions.js";
import { normalizeVietnamPhone } from "../normalizers/vietnamPhone.js";

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/api/v1/settings/suppressed-numbers", async (_request, reply) => {
    const entries = await listSuppressions();
    return reply.send({ entries });
  });

  app.post<{ Body: { phone_raw: string; reason?: string } }>("/api/v1/settings/suppressed-numbers", async (request, reply) => {
    const { phone_raw, reason } = request.body ?? {};
    if (!phone_raw || typeof phone_raw !== "string") {
      return reply.status(400).send({ error: "missing_phone_raw" });
    }

    const result = await suppressNumber(phone_raw, reason);
    if (!result.valid) {
      return reply.status(422).send({ error: "invalid_phone_format", phone_raw });
    }
    return reply.send({ phone_normalized: result.phoneNormalized, suppressed: true });
  });

  app.delete<{ Params: { phone: string } }>("/api/v1/settings/suppressed-numbers/:phone", async (request, reply) => {
    const result = await unsuppressNumber(request.params.phone);
    if (!result.valid) {
      return reply.status(422).send({ error: "invalid_phone_format", phone_raw: request.params.phone });
    }
    return reply.send({ phone_normalized: result.phoneNormalized, suppressed: false });
  });

  app.get<{ Params: { phone: string } }>("/api/v1/settings/suppressed-numbers/:phone/status", async (request, reply) => {
    const normalized = normalizeVietnamPhone(request.params.phone);
    if (!normalized.normalized) {
      return reply.status(422).send({ error: "invalid_phone_format", phone_raw: request.params.phone });
    }
    const suppressed = await isSuppressed(normalized.normalized);
    return reply.send({ phone_normalized: normalized.normalized, suppressed });
  });
}
