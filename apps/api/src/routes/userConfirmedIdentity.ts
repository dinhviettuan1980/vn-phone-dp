import type { FastifyInstance } from "fastify";
import { importUserConfirmedIdentities } from "../services/userConfirmedIdentity.js";
import type { IdentityCategory, IdentityType } from "@phoneintel/shared-types";

interface ImportBody {
  entries: Array<{
    phone_raw: string;
    display_name: string;
    identity_type?: IdentityType;
    category?: IdentityCategory;
    note_source?: string;
  }>;
}

export async function userConfirmedIdentityRoutes(app: FastifyInstance) {
  app.post<{ Body: ImportBody }>("/api/v1/identities/user-confirmed", async (request, reply) => {
    const { entries } = request.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return reply.status(400).send({ error: "entries must be a non-empty array" });
    }

    const results = await importUserConfirmedIdentities(
      entries.map((e) => ({
        phoneRaw: e.phone_raw,
        displayName: e.display_name,
        identityType: e.identity_type,
        category: e.category,
        noteSource: e.note_source,
      }))
    );

    return reply.send({
      imported: results.filter((r) => r.valid).length,
      skipped: results.filter((r) => !r.valid).length,
      results,
    });
  });
}
