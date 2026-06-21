import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config/env";
import * as schema from "./schema";

/**
 * postgres-js connection. It connects lazily (on first query), so importing
 * this module is cheap and safe in tests that never touch the DB.
 *
 * `prepare: false` is required when talking to Supabase's transaction-mode
 * connection pooler (port 6543), which doesn't support prepared statements.
 */
export const queryClient = postgres(config.DATABASE_URL, {
  max: config.DB_POOL_MAX,
  prepare: false,
});

export const db = drizzle(queryClient, { schema });

export type Database = typeof db;
