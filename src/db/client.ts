import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config/env";
import * as schema from "./schema";
import { sslOptions } from "./ssl";

/**
 * postgres-js connection. It connects lazily (on first query), so importing
 * this module is cheap and safe in tests that never touch the DB.
 *
 * `prepare: false` is kept for compatibility with transaction-mode poolers
 * (pgbouncer); it is harmless against a direct connection.
 *
 * When DATABASE_CA_CERT is set (DigitalOcean Managed Postgres), the
 * connection verifies the server certificate against that CA.
 */
const ssl = sslOptions(config.DATABASE_CA_CERT);

export const queryClient = postgres(config.DATABASE_URL, {
  max: config.DB_POOL_MAX,
  prepare: false,
  ...(ssl ? { ssl } : {}),
});

export const db = drizzle(queryClient, { schema });

export type Database = typeof db;
