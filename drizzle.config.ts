import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Migrations run best against the DIRECT Supabase connection (port 5432), which
// supports the advisory locks drizzle-kit uses. The app itself runs against the
// transaction POOLER (6543). Prefer DIRECT_DATABASE_URL when set, falling back
// to DATABASE_URL for local/dev where the two are the same.
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DIRECT_DATABASE_URL or DATABASE_URL is required for drizzle-kit operations.",
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  casing: "snake_case",
  // This is a shared Supabase database — only manage our own `public` schema.
  // Without this, drizzle-kit introspects Supabase's `auth`/`realtime` schemas
  // and crashes parsing one of their CHECK constraints.
  schemaFilter: ["public"],
  verbose: true,
  strict: true,
});
