import { getDataQualityStats } from "../services/stats.js";
import { pool } from "../db/client.js";

const s = await getDataQualityStats();

console.log("=====================================");
console.log("PHONE INTELLIGENCE DATA STATISTICS");
console.log("=====================================");
console.log(`Raw Documents:            ${s.total_raw_documents}`);
console.log(`Phone Observations:       ${s.total_observations}`);
console.log(`Unique Phones:            ${s.total_unique_phone_numbers}`);
console.log(`Valid Phones:             ${s.valid_phones}`);
console.log(`Invalid Candidates:       ${s.invalid_phone_candidates}`);
console.log(`Phones with > 3 evidence: ${s.phones_with_multiple_evidence}`);
console.log(`Duplicate content ratio:  ${(s.duplicate_content_ratio * 100).toFixed(1)}%`);
if (s.top_sources_by_phone_count[0]) {
  console.log(`Top Source:               ${s.top_sources_by_phone_count[0].name}`);
  console.log(`  ${s.top_sources_by_phone_count[0].phone_count} observations`);
}
console.log("=====================================");

await pool.end();
