import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// drizzle-kit is used locally for `db:generate`, `db:push` and `db:studio`.
// Production migrations are applied by `node dist/db/migrate.js` (see
// src/db/migrate.ts), which reads the same ./drizzle folder.
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required for drizzle-kit operations.");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  casing: "snake_case",
  // Only manage our own `public` schema.
  schemaFilter: ["public"],
  verbose: true,
  strict: true,
});
