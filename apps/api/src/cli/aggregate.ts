import { runAggregation } from "../services/aggregation.js";
import { pool } from "../db/client.js";

const result = await runAggregation();
console.log(`[aggregate] phones_processed=${result.phonesProcessed} identities_upserted=${result.identitiesUpserted} evidence_links_created=${result.evidenceLinksCreated}`);
await pool.end();
