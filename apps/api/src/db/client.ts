import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL ?? "postgres://phoneintel:phoneintel@localhost:55432/phoneintel";

export const pool = new pg.Pool({ connectionString });
export const db = drizzle(pool, { schema });
