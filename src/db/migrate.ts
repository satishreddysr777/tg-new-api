import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { config } from "../config/env";
import { sslOptions } from "./ssl";

/**
 * Applies pending SQL migrations from ./drizzle. Used by the App Platform
 * PRE_DEPLOY job (`node dist/db/migrate.js`) and by `npm run db:migrate`.
 *
 * Uses drizzle-orm's built-in migrator, which reads drizzle/meta/_journal.json
 * and records progress in drizzle.__drizzle_migrations — the same journal and
 * table drizzle-kit uses, so history generated with drizzle-kit is honoured.
 * Needs no devDependencies at runtime.
 */
async function main(): Promise<void> {
  const ssl = sslOptions(config.DATABASE_CA_CERT);
  const client = postgres(config.DATABASE_URL, {
    max: 1,
    prepare: false,
    ...(ssl ? { ssl } : {}),
  });
  const db = drizzle(client);
  // dist/db/migrate.js → ../../drizzle == <project root>/drizzle
  const migrationsFolder = path.resolve(__dirname, "../../drizzle");

  try {
    console.log(`[migrate] applying migrations from ${migrationsFolder}`);
    await migrate(db, { migrationsFolder });
    console.log("[migrate] done");
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error("[migrate] failed", err);
  process.exit(1);
});
