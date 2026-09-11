# DigitalOcean Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Technograph's two services (tg-api, tg-ui) to DigitalOcean App Platform with Managed Postgres, deployed independently by GitHub Actions on push to `main`.

**Architecture:** Each repo gets a multi-stage Dockerfile, a `.do/app.yaml` App Platform spec, and two GitHub workflows (CI on PRs, deploy on `main`). The API image also runs schema migrations as a PRE_DEPLOY job through a small programmatic migrator, and trusts the DO database CA via a new `DATABASE_CA_CERT` env var. Spec: `docs/superpowers/specs/2026-09-11-digitalocean-deployment-design.md`.

**Tech Stack:** Node 20 (Docker `node:20-alpine`), Fastify 5, Drizzle ORM 0.38 (`postgres-js`), Next.js 14 (standalone output), GitHub Actions, `digitalocean/app_action/deploy@v2`, doctl, DO Managed Postgres 16.

## Global Constraints

- Two separate git repos. tg-api lives at `/Users/satishreddy/Desktop/CurrentDevelopment/new/tg-api` (GitHub `satishreddysr777/tg-new-api`). tg-ui lives at `/Users/satishreddy/Desktop/CurrentDevelopment/new/tg-ui` (GitHub `satishreddysr777/tg-new-ui`). Every `git` command below states which repo it runs in.
- Docker base image is exactly `node:20-alpine`. App Platform region `nyc`; database region `nyc3`, size `db-amd-1vcpu-1gb`, engine `pg` version `16`, cluster name `tg-postgres`, database `technograph`, user `tg_api`.
- App names are exactly `tg-api` and `tg-ui`. Instance size `basic-xxs`, count 1.
- API container listens on port `8080`; UI container on `3000`.
- `JWT_SECRET` and `SESSION_COOKIE_NAME=tg_session` must be identical on both apps.
- Secrets are never committed. App specs use `${NAME}` placeholders filled by the deploy action from GitHub secrets/variables. DO bindables `${db.DATABASE_URL}` and `${db.CA_CERT}` are left as-is.
- Lint is not part of CI (no ESLint config exists in either repo).
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Do not create the DO database cluster, create DO tokens, or push to GitHub until Task 11, which pauses for user confirmation because those steps are billable or outward-facing.

---

## File map

tg-api (create): `src/db/ssl.ts`, `test/ssl.test.ts`, `src/db/migrate.ts`, `Dockerfile`, `.dockerignore`, `.do/app.yaml`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `docs/DEPLOY.md`
tg-api (modify): `src/config/env.ts`, `src/db/client.ts`, `drizzle.config.ts`, `package.json`, `.env.example`, `.env.production.example`, `README.md`
tg-api (delete): `railway.json`, `nixpacks.toml`
tg-ui (create): `Dockerfile`, `.dockerignore`, `.do/app.yaml`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`
tg-ui (modify): `next.config.mjs`, `.env.production.example`
Workspace root (modify): `DEPLOY.md` (copy of `tg-api/docs/DEPLOY.md`)

---

### Task 1: SSL options helper (tg-api)

**Files:**
- Create: `tg-api/src/db/ssl.ts`
- Test: `tg-api/test/ssl.test.ts`

**Interfaces:**
- Produces: `sslOptions(caCert: string | undefined): DbSsl | undefined` where `type DbSsl = { ca: string; rejectUnauthorized: true }`. Tasks 2 and 3 import it from `./ssl` / `../src/db/ssl`.

- [ ] **Step 1: Write the failing test**

Create `tg-api/test/ssl.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sslOptions } from "../src/db/ssl";

describe("sslOptions", () => {
  it("returns undefined when no CA cert is configured", () => {
    expect(sslOptions(undefined)).toBeUndefined();
    expect(sslOptions("")).toBeUndefined();
    expect(sslOptions("   \n")).toBeUndefined();
  });

  it("returns verified TLS options when a CA cert is given", () => {
    const pem = "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n";
    expect(sslOptions(pem)).toEqual({ ca: pem.trim(), rejectUnauthorized: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (in tg-api): `npx vitest run test/ssl.test.ts`
Expected: FAIL — "Failed to resolve import "../src/db/ssl"".

- [ ] **Step 3: Write minimal implementation**

Create `tg-api/src/db/ssl.ts`:

```ts
/**
 * TLS options for postgres-js when talking to a managed database that uses
 * its own certificate authority (DigitalOcean injects the cluster CA as
 * DATABASE_CA_CERT). Returns undefined when no CA is configured so local dev
 * and tests keep the plain connection-string behaviour.
 */
export type DbSsl = { ca: string; rejectUnauthorized: true };

export function sslOptions(caCert: string | undefined): DbSsl | undefined {
  const ca = caCert?.trim();
  if (!ca) return undefined;
  return { ca, rejectUnauthorized: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (in tg-api): `npx vitest run test/ssl.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-api
git add src/db/ssl.ts test/ssl.test.ts
git commit -m "feat(db): add sslOptions helper for CA-verified TLS

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `DATABASE_CA_CERT` env var and client wiring (tg-api)

**Files:**
- Modify: `tg-api/src/config/env.ts` (schema object, after `DB_POOL_MAX`)
- Modify: `tg-api/src/db/client.ts`

**Interfaces:**
- Consumes: `sslOptions` from Task 1.
- Produces: `config.DATABASE_CA_CERT: string` (default `""`). Task 3 reads it.

- [ ] **Step 1: Add the env field**

In `tg-api/src/config/env.ts`, directly after the `DB_POOL_MAX` line inside `Type.Object({...})`, add:

```ts
  // PEM CA certificate of a managed Postgres cluster (DigitalOcean injects
  // ${db.CA_CERT}). When set, TLS is verified against it. Empty = unchanged.
  DATABASE_CA_CERT: Type.String({ default: "" }),
```

- [ ] **Step 2: Wire it into the client**

Replace the whole of `tg-api/src/db/client.ts` with:

```ts
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
```

- [ ] **Step 3: Typecheck and run the full suite**

Run (in tg-api): `npm run typecheck && npm test`
Expected: typecheck clean; all tests PASS (auth suite + ssl suite).

- [ ] **Step 4: Commit**

```bash
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-api
git add src/config/env.ts src/db/client.ts
git commit -m "feat(db): trust DATABASE_CA_CERT for managed Postgres TLS

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Programmatic migrator and drizzle config cleanup (tg-api)

**Files:**
- Create: `tg-api/src/db/migrate.ts`
- Modify: `tg-api/drizzle.config.ts`
- Modify: `tg-api/package.json` (`scripts.db:migrate`)
- Modify: `tg-api/.env.example`, `tg-api/.env.production.example`

**Interfaces:**
- Consumes: `config.DATABASE_URL`, `config.DATABASE_CA_CERT` (Task 2), `sslOptions` (Task 1).
- Produces: `dist/db/migrate.js`, run as `node dist/db/migrate.js` by Task 4's Docker verification and Task 5's PRE_DEPLOY job. Exit code 0 on success, 1 on failure.

- [ ] **Step 1: Create the migrator**

Create `tg-api/src/db/migrate.ts`:

```ts
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
```

- [ ] **Step 2: Simplify drizzle.config.ts**

Replace the whole of `tg-api/drizzle.config.ts` with:

```ts
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
```

- [ ] **Step 3: Point `db:migrate` at the compiled migrator**

In `tg-api/package.json` change the script line

```json
    "db:migrate": "drizzle-kit migrate",
```

to

```json
    "db:migrate": "npm run build && node dist/db/migrate.js",
```

- [ ] **Step 4: Update env examples**

In `tg-api/.env.example`, replace the `# --- Database (Supabase Postgres + Drizzle) ---` block (from that heading through the `# ... then back to the pooler for the app.` comment) with:

```
# --- Database (Postgres + Drizzle) ---
# Local dev: any Postgres. Production: DigitalOcean Managed Postgres, injected
# by App Platform as ${db.DATABASE_URL} (includes ?sslmode=require).
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/technograph
DB_POOL_MAX=10
# PEM CA certificate for a managed cluster (DigitalOcean: ${db.CA_CERT}).
# Leave empty locally.
DATABASE_CA_CERT=
```

Replace the whole of `tg-api/.env.production.example` with:

```
# ── tg-api · DigitalOcean App Platform environment ──────────────────────────
# These are declared in .do/app.yaml. Values marked ${NAME} are filled from
# GitHub Actions secrets/variables by the deploy workflow; ${db.*} values are
# injected by App Platform from the attached Managed Postgres cluster.
# Do NOT commit real secrets.

NODE_ENV=production
HOST=0.0.0.0
PORT=8080
LOG_LEVEL=info

# Allow the tg-ui app's origin. Comma-separated, no spaces.
CORS_ORIGINS=https://tg-ui-xxxxx.ondigitalocean.app

# ── Database (DigitalOcean Managed Postgres) ─────────────────────────────────
DATABASE_URL=${db.DATABASE_URL}
DATABASE_CA_CERT=${db.CA_CERT}
DB_POOL_MAX=10

# ── Auth ─────────────────────────────────────────────────────────────────────
# MUST be identical to tg-ui's JWT_SECRET. Generate once: `openssl rand -hex 32`
JWT_SECRET=${JWT_SECRET}
JWT_ACCESS_TTL=12h
BCRYPT_ROUNDS=12
MFA_CHALLENGE_TTL_SECONDS=300
MFA_ENABLED=false

# ── App / email ──────────────────────────────────────────────────────────────
# Public origin of the deployed web app — used to build invite / reset links.
APP_URL=https://tg-ui-xxxxx.ondigitalocean.app
# Resend API key. Leave empty to log magic links to the app logs instead.
RESEND_API_KEY=${RESEND_API_KEY}
MAIL_FROM=Technograph <onboarding@your-domain.com>
INVITE_TTL_HOURS=168
SESSION_COOKIE_NAME=tg_session
```

- [ ] **Step 5: Build, typecheck, test**

Run (in tg-api): `npm run typecheck && npm test && npm run build && ls dist/db/migrate.js`
Expected: all green; `dist/db/migrate.js` exists.

- [ ] **Step 6: Verify the migrator against a throwaway Postgres**

```bash
docker run -d --rm --name tg-pg-test -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:16-alpine
until docker exec tg-pg-test pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-api
DATABASE_URL=postgres://postgres:pg@localhost:55432/postgres node dist/db/migrate.js
docker exec tg-pg-test psql -U postgres -c "select count(*) from drizzle.__drizzle_migrations;"
```

Expected: `[migrate] done`; the count equals the number of files in `drizzle/*.sql` (11). Running the migrator a second time prints `[migrate] done` with no errors and the count stays 11. Leave the container running; Task 4 reuses it. (`.env` is loaded by env-schema, but the explicit `DATABASE_URL=` on the command line wins.)

- [ ] **Step 7: Commit**

```bash
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-api
git add src/db/migrate.ts drizzle.config.ts package.json .env.example .env.production.example
git commit -m "feat(db): programmatic migrator for App Platform PRE_DEPLOY job

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: API Dockerfile, remove Railway files (tg-api)

**Files:**
- Create: `tg-api/Dockerfile`, `tg-api/.dockerignore`
- Delete: `tg-api/railway.json`, `tg-api/nixpacks.toml`

**Interfaces:**
- Produces: image that runs `node dist/server.js` on `$PORT` (default 8080) and contains `dist/db/migrate.js` + `drizzle/`. Task 5's spec references `dockerfile_path: Dockerfile`.

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
dist
.env
.env.*
!.env.example
!.env.production.example
*.log
coverage
.git
.github
.do
docs
test
.DS_Store
```

- [ ] **Step 2: Create the Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1

# ── 1. install all deps (incl. dev) ─────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── 2. compile TypeScript → dist/ ───────────────────────────────────────────
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── 3. lean runtime image ────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# SQL migrations + journal, read by `node dist/db/migrate.js` (PRE_DEPLOY job)
COPY drizzle ./drizzle
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

- [ ] **Step 3: Delete the Railway files**

```bash
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-api
git rm -q railway.json nixpacks.toml
```

- [ ] **Step 4: Build and smoke-test the image**

```bash
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-api
docker build -t tg-api:local .
docker run -d --rm --name tg-api-smoke -p 18080:8080 \
  -e PORT=8080 -e DATABASE_URL=postgres://x:y@localhost:5432/z \
  -e JWT_SECRET=$(openssl rand -hex 32) tg-api:local
sleep 3
curl -fsS http://localhost:18080/health
docker stop tg-api-smoke
```

Expected: `docker build` succeeds; curl prints `{"status":"ok","uptimeSeconds":...}`. (`/health` never touches the DB and the client connects lazily, so the fake URL is fine.)

- [ ] **Step 5: Verify the migrator inside the image**

```bash
docker run --rm -e NODE_ENV=production -e JWT_SECRET=$(openssl rand -hex 32) \
  -e DATABASE_URL=postgres://postgres:pg@host.docker.internal:55432/postgres \
  tg-api:local node dist/db/migrate.js
docker stop tg-pg-test
```

Expected: `[migrate] done` (idempotent re-run against the Task 3 container). Then the test Postgres is stopped.

- [ ] **Step 6: Commit**

```bash
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-api
git add Dockerfile .dockerignore
git commit -m "build: multi-stage Dockerfile for App Platform; drop Railway config

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: API App Platform spec (tg-api)

**Files:**
- Create: `tg-api/.do/app.yaml`

**Interfaces:**
- Consumes: Dockerfile (Task 4), `node dist/db/migrate.js` (Task 3).
- Produces: placeholders `${JWT_SECRET}`, `${RESEND_API_KEY}`, `${APP_URL}`, `${CORS_ORIGINS}`, `${MAIL_FROM}` that Task 6's deploy workflow must supply via `env:`.

- [ ] **Step 1: Write the spec**

Create `tg-api/.do/app.yaml`:

```yaml
# DigitalOcean App Platform spec for tg-api.
# Deployed by .github/workflows/deploy.yml via digitalocean/app_action/deploy@v2.
# ${NAME} placeholders are filled from the workflow's env; ${db.*} bindables
# are resolved by App Platform from the attached Managed Postgres cluster.
name: tg-api
region: nyc

databases:
  - name: db
    engine: PG
    production: true
    cluster_name: tg-postgres
    db_name: technograph
    db_user: tg_api

services:
  - name: api
    dockerfile_path: Dockerfile
    source_dir: /
    github:
      repo: satishreddysr777/tg-new-api
      branch: main
      deploy_on_push: false
    http_port: 8080
    instance_size_slug: basic-xxs
    instance_count: 1
    health_check:
      http_path: /health
      initial_delay_seconds: 10
      period_seconds: 10
    envs:
      - key: NODE_ENV
        value: production
      - key: HOST
        value: 0.0.0.0
      - key: PORT
        value: "8080"
      - key: LOG_LEVEL
        value: info
      - key: DATABASE_URL
        value: ${db.DATABASE_URL}
        type: SECRET
      - key: DATABASE_CA_CERT
        value: ${db.CA_CERT}
        type: SECRET
      - key: DB_POOL_MAX
        value: "10"
      - key: JWT_SECRET
        value: ${JWT_SECRET}
        type: SECRET
      - key: JWT_ACCESS_TTL
        value: 12h
      - key: MFA_ENABLED
        value: "false"
      - key: SESSION_COOKIE_NAME
        value: tg_session
      - key: APP_URL
        value: ${APP_URL}
      - key: CORS_ORIGINS
        value: ${CORS_ORIGINS}
      - key: RESEND_API_KEY
        value: ${RESEND_API_KEY}
        type: SECRET
      - key: MAIL_FROM
        value: ${MAIL_FROM}

jobs:
  - name: migrate
    kind: PRE_DEPLOY
    dockerfile_path: Dockerfile
    source_dir: /
    github:
      repo: satishreddysr777/tg-new-api
      branch: main
      deploy_on_push: false
    run_command: node dist/db/migrate.js
    instance_size_slug: basic-xxs
    instance_count: 1
    envs:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        value: ${db.DATABASE_URL}
        type: SECRET
      - key: DATABASE_CA_CERT
        value: ${db.CA_CERT}
        type: SECRET
      # config/env validates JWT_SECRET at import time (and rejects the dev
      # default in production), so the job needs a real value too.
      - key: JWT_SECRET
        value: ${JWT_SECRET}
        type: SECRET
```

- [ ] **Step 2: Validate the spec locally**

Run (in tg-api):

```bash
sed -e 's/\${JWT_SECRET}/placeholder-secret-0123456789abcdef/' \
    -e 's/\${RESEND_API_KEY}//' -e 's#\${APP_URL}#https://placeholder#' \
    -e 's#\${CORS_ORIGINS}#https://placeholder#' -e 's/\${MAIL_FROM}/x@y.z/' \
    .do/app.yaml > /tmp/tg-api-spec.yaml
doctl apps spec validate /tmp/tg-api-spec.yaml
```

Expected: the command prints the normalised spec with no error. (`spec validate` checks structure only; it does not require the cluster to exist.) If it reports `initial_delay_seconds` or `period_seconds` as unknown, remove those two lines and re-run.

- [ ] **Step 3: Commit**

```bash
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-api
git add .do/app.yaml
git commit -m "deploy: App Platform spec with Managed Postgres and PRE_DEPLOY migrate job

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: API GitHub workflows (tg-api)

**Files:**
- Create: `tg-api/.github/workflows/ci.yml`, `tg-api/.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: spec placeholders from Task 5. GitHub secrets `DIGITALOCEAN_ACCESS_TOKEN`, `JWT_SECRET`, `RESEND_API_KEY`; variables `APP_URL`, `CORS_ORIGINS`, `MAIL_FROM` (set in Task 11).

- [ ] **Step 1: Create `ci.yml`**

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  checks:
    name: Typecheck, test, build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Create `deploy.yml`**

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

# Never run two deploys of this app at once; queue instead of cancelling so a
# queued deploy still ships the latest commit.
concurrency:
  group: deploy-tg-api
  cancel-in-progress: false

jobs:
  checks:
    name: Typecheck, test, build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build

  deploy:
    name: Deploy to DigitalOcean App Platform
    needs: checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy tg-api
        uses: digitalocean/app_action/deploy@v2
        env:
          # Substituted into ${NAME} placeholders in .do/app.yaml.
          JWT_SECRET: ${{ secrets.JWT_SECRET }}
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          APP_URL: ${{ vars.APP_URL }}
          CORS_ORIGINS: ${{ vars.CORS_ORIGINS }}
          MAIL_FROM: ${{ vars.MAIL_FROM }}
        with:
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
          app_spec_location: .do/app.yaml
          print_build_logs: true
          print_deploy_logs: true
```

- [ ] **Step 3: Validate YAML parses**

Run (in tg-api): `npx --yes js-yaml .github/workflows/ci.yml >/dev/null && npx --yes js-yaml .github/workflows/deploy.yml >/dev/null && echo ok`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-api
git add .github/workflows/ci.yml .github/workflows/deploy.yml
git commit -m "ci: PR checks and main-branch deploy to App Platform

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: UI standalone build and Dockerfile (tg-ui)

**Files:**
- Modify: `tg-ui/next.config.mjs`
- Create: `tg-ui/Dockerfile`, `tg-ui/.dockerignore`

**Interfaces:**
- Produces: image that runs `node server.js` on `$PORT` (default 3000), built with build arg `API_ORIGIN` (the only build-time value; `JWT_SECRET` and `SESSION_COOKIE_NAME` are read by middleware at runtime — verified empirically). Task 8's spec references `dockerfile_path: Dockerfile`, passes `API_ORIGIN` as BUILD_AND_RUN_TIME and the other two as RUN_TIME.

- [ ] **Step 1: Enable standalone output**

Replace the whole of `tg-ui/next.config.mjs` with:

```js
/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

const nextConfig = {
  // Self-contained server bundle (.next/standalone) for the Docker image.
  output: "standalone",
  async rewrites() {
    // Proxy API calls to tg-api so the session cookie is first-party to the
    // Next app — which lets middleware read it for route protection.
    // NOTE: API_ORIGIN is baked in at build time.
    return [
      {
        source: "/api/v1/:path*",
        destination: `${API_ORIGIN}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 2: Create `.dockerignore`**

```
node_modules
.next
out
build
.git
.github
.do
.env*
!.env.production.example
*.tsbuildinfo
.DS_Store
.vercel
```

- [ ] **Step 3: Create the Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1

# ── 1. install deps ─────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── 2. build (API_ORIGIN is baked into next.config rewrites here;
#      JWT_SECRET and SESSION_COOKIE_NAME are read at runtime) ───────────────
FROM deps AS build
ARG API_ORIGIN
ENV API_ORIGIN=$API_ORIGIN \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

# ── 3. runtime: standalone server only ──────────────────────────────────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
```

(There is no `public/` directory in tg-ui, so nothing else is copied. If one is added later, add `COPY --from=build /app/public ./public`.)

- [ ] **Step 4: Build and smoke-test**

```bash
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-ui
docker build --build-arg API_ORIGIN=http://localhost:4000 -t tg-ui:local .
docker run -d --rm --name tg-ui-smoke -p 13000:3000 tg-ui:local
sleep 3
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:13000/login
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:13000/portal
docker stop tg-ui-smoke
```

Expected: build succeeds; `/login` → `200`; `/portal` → `307` (middleware redirect to login, proving middleware runs in the standalone server).

- [ ] **Step 5: Commit**

```bash
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-ui
git add next.config.mjs Dockerfile .dockerignore
git commit -m "build: standalone Next output and Dockerfile for App Platform

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: UI App Platform spec, workflows, env example (tg-ui)

**Files:**
- Create: `tg-ui/.do/app.yaml`, `tg-ui/.github/workflows/ci.yml`, `tg-ui/.github/workflows/deploy.yml`
- Modify: `tg-ui/.env.production.example`

**Interfaces:**
- Consumes: Dockerfile build arg `API_ORIGIN` from Task 7 (`JWT_SECRET`/`SESSION_COOKIE_NAME` are runtime-only).
- Produces: placeholders `${API_ORIGIN}`, `${JWT_SECRET}`. GitHub secrets `DIGITALOCEAN_ACCESS_TOKEN`, `JWT_SECRET`; variable `API_ORIGIN` (set in Task 11).

- [ ] **Step 1: Write the spec**

Create `tg-ui/.do/app.yaml`:

```yaml
# DigitalOcean App Platform spec for tg-ui.
# Deployed by .github/workflows/deploy.yml via digitalocean/app_action/deploy@v2.
# ${NAME} placeholders are filled from the workflow's env.
name: tg-ui
region: nyc

services:
  - name: web
    dockerfile_path: Dockerfile
    source_dir: /
    github:
      repo: satishreddysr777/tg-new-ui
      branch: main
      deploy_on_push: false
    http_port: 3000
    instance_size_slug: basic-xxs
    instance_count: 1
    health_check:
      http_path: /login
      initial_delay_seconds: 10
      period_seconds: 10
    envs:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: "3000"
      - key: HOSTNAME
        value: 0.0.0.0
      # BUILD_AND_RUN_TIME envs are passed to `docker build` as --build-arg.
      # API_ORIGIN is baked into next.config rewrites at build time.
      - key: API_ORIGIN
        value: ${API_ORIGIN}
        scope: BUILD_AND_RUN_TIME
      # Read by middleware at runtime only — never needed during the build.
      - key: JWT_SECRET
        value: ${JWT_SECRET}
        type: SECRET
        scope: RUN_TIME
      - key: SESSION_COOKIE_NAME
        value: tg_session
        scope: RUN_TIME
```

- [ ] **Step 2: Validate the spec**

```bash
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-ui
sed -e 's/\${JWT_SECRET}/placeholder-secret-0123456789abcdef/' \
    -e 's#\${API_ORIGIN}#https://placeholder#' .do/app.yaml > /tmp/tg-ui-spec.yaml
doctl apps spec validate /tmp/tg-ui-spec.yaml
```

Expected: normalised spec printed, no error.

- [ ] **Step 3: Create `ci.yml`**

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  checks:
    name: Build (includes type check)
    runs-on: ubuntu-latest
    env:
      # Placeholder so `next build` is deterministic in CI; the real value is
      # supplied by App Platform at build time.
      API_ORIGIN: https://placeholder.invalid
      NEXT_TELEMETRY_DISABLED: "1"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
```

- [ ] **Step 4: Create `deploy.yml`**

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-tg-ui
  cancel-in-progress: false

jobs:
  checks:
    name: Build (includes type check)
    runs-on: ubuntu-latest
    env:
      API_ORIGIN: https://placeholder.invalid
      NEXT_TELEMETRY_DISABLED: "1"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build

  deploy:
    name: Deploy to DigitalOcean App Platform
    needs: checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy tg-ui
        uses: digitalocean/app_action/deploy@v2
        env:
          # Substituted into ${NAME} placeholders in .do/app.yaml.
          API_ORIGIN: ${{ vars.API_ORIGIN }}
          JWT_SECRET: ${{ secrets.JWT_SECRET }}
        with:
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
          app_spec_location: .do/app.yaml
          print_build_logs: true
          print_deploy_logs: true
```

- [ ] **Step 5: Update `.env.production.example`**

Replace the whole of `tg-ui/.env.production.example` with:

```
# ── tg-ui · DigitalOcean App Platform environment ───────────────────────────
# Declared in .do/app.yaml; ${NAME} values come from GitHub Actions
# secrets/variables via the deploy workflow. Do NOT commit real secrets.

# Public URL of the tg-api app. All /api/v1/* calls are proxied here so the
# session cookie stays first-party. Baked in at BUILD time — changing it
# requires a redeploy.
API_ORIGIN=https://tg-api-xxxxx.ondigitalocean.app

# MUST be identical to tg-api's JWT_SECRET so the Next middleware can verify
# the session cookie. Read at RUN time (not baked into the build).
JWT_SECRET=${JWT_SECRET}

# Must match tg-api's SESSION_COOKIE_NAME.
SESSION_COOKIE_NAME=tg_session

# Leave NEXT_PUBLIC_API_URL UNSET so the browser uses the same-origin "/api/v1"
# proxy.
```

- [ ] **Step 6: Validate YAML and commit**

```bash
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-ui
npx --yes js-yaml .github/workflows/ci.yml >/dev/null && npx --yes js-yaml .github/workflows/deploy.yml >/dev/null && echo ok
git add .do/app.yaml .github/workflows/ci.yml .github/workflows/deploy.yml .env.production.example
git commit -m "deploy: App Platform spec and GitHub Actions CI/CD

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Deployment runbook (tg-api docs + workspace root)

**Files:**
- Create: `tg-api/docs/DEPLOY.md`
- Modify: `tg-api/README.md` (add a Deployment section after the "Stack & conventions" table)
- Modify (overwrite): `/Users/satishreddy/Desktop/CurrentDevelopment/new/DEPLOY.md` with the same content

- [ ] **Step 1: Write `tg-api/docs/DEPLOY.md`**

````markdown
# Deploying Technograph on DigitalOcean

Two independently deployed App Platform apps plus one Managed Postgres cluster.

| App      | Repo                              | What it is                          | Spec                 |
| -------- | --------------------------------- | ----------------------------------- | -------------------- |
| `tg-ui`  | `satishreddysr777/tg-new-ui`      | Next.js web app (portal + console)  | `tg-ui/.do/app.yaml` |
| `tg-api` | `satishreddysr777/tg-new-api`     | Fastify API + migrate job           | `tg-api/.do/app.yaml`|

```
Browser ──► tg-ui (App Platform)
                │  rewrites /api/v1/* server-side (API_ORIGIN)
                ▼
            tg-api (App Platform) ──► tg-postgres (Managed Postgres 16)
                └─ PRE_DEPLOY job "migrate": node dist/db/migrate.js
```

Every push to `main` in either repo runs `.github/workflows/deploy.yml`:
typecheck/tests/build, then `digitalocean/app_action/deploy@v2` updates the
app from `.do/app.yaml`. Pull requests run `ci.yml` (checks only). Deploys can
also be re-run from the Actions tab (`workflow_dispatch`).

## The one rule that breaks everything if you miss it

`JWT_SECRET` **must be identical** on both apps, and `SESSION_COOKIE_NAME`
must match (`tg_session`). Generate once and use it in both repos' secrets:

```bash
openssl rand -hex 32
```

## 0. One-time prerequisites

1. **DigitalOcean API token** — cloud.digitalocean.com → API → Generate New
   Token, full access (apps + databases read/write). Keep it for step 2.
2. **Authorise App Platform to read GitHub** — cloud.digitalocean.com → Apps →
   Create App → GitHub → "Manage Access" → grant `tg-new-api` and `tg-new-ui`.
   You can cancel the wizard after granting access; the workflow creates the
   apps.
3. **Tooling on your machine**: `doctl` (authenticated), `gh` (authenticated),
   `psql`/`pg_dump` ≥ the Supabase server version (`brew install libpq` and
   add it to PATH, or `brew install postgresql@17`).

## 1. Database

```bash
doctl databases create tg-postgres --engine pg --version 16 \
  --region nyc3 --size db-amd-1vcpu-1gb --num-nodes 1 --wait
DB_ID=$(doctl databases list --format ID,Name --no-header | awk '$2=="tg-postgres"{print $1}')
doctl databases db create   "$DB_ID" technograph
doctl databases user create "$DB_ID" tg_api

# Postgres 15+ no longer lets ordinary users create tables in `public`, and the
# migrator also creates the `drizzle` schema. Grant both to tg_api once.
# (Works now because no trusted sources are configured yet; once the app is
# attached, add your IP as in step 4 before running psql again.)
ADMIN_URI=$(doctl databases connection "$DB_ID" --format URI --no-header | sed 's#/defaultdb#/technograph#')
psql "$ADMIN_URI" -v ON_ERROR_STOP=1 \
  -c "GRANT ALL ON DATABASE technograph TO tg_api;" \
  -c "ALTER SCHEMA public OWNER TO tg_api;"
```

The app spec attaches the cluster by name (`cluster_name: tg-postgres`,
`db_name: technograph`, `db_user: tg_api`) and App Platform injects
`DATABASE_URL` and the CA certificate (`DATABASE_CA_CERT`) into the API. The
API app is added to the cluster's trusted sources automatically on attach.

## 2. GitHub secrets and variables

API repo:

```bash
cd tg-api
gh secret set DIGITALOCEAN_ACCESS_TOKEN      # paste the token from step 0.1
gh secret set JWT_SECRET                     # the openssl value
gh secret set RESEND_API_KEY --body ""       # or a real Resend key
gh variable set APP_URL      --body "https://placeholder"
gh variable set CORS_ORIGINS --body "https://placeholder"
gh variable set MAIL_FROM    --body "Technograph <onboarding@your-domain.com>"
```

UI repo:

```bash
cd tg-ui
gh secret set DIGITALOCEAN_ACCESS_TOKEN      # same token
gh secret set JWT_SECRET                     # the SAME openssl value
gh variable set API_ORIGIN --body "https://placeholder"
```

## 3. First API deploy

```bash
cd tg-api && git push origin main
```

Watch the **Deploy** workflow in GitHub. On first run the action creates the
app, builds the Dockerfile, runs the `migrate` job (creating the schema), then
starts the service. Get the URL:

```bash
doctl apps list --format Spec.Name,DefaultIngress
curl https://tg-api-xxxxx.ondigitalocean.app/health   # {"status":"ok",...}
```

## 4. Copy data from Supabase (one time)

Run **after** step 3 so the schema and migration history already exist.

```bash
# Attaching the app turned on trusted sources, so allow this machine temporarily.
MY_IP=$(curl -s https://api.ipify.org)
doctl databases firewalls append "$DB_ID" --rule "ip_addr:${MY_IP}"

# Supabase: Settings → Database → Connection string → Direct (port 5432)
export SUPABASE_DIRECT_URL='postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres'
# DO: connect as tg_api to the technograph database
DB_HOST=$(doctl databases connection "$DB_ID" --format Host --no-header)
DB_PORT=$(doctl databases connection "$DB_ID" --format Port --no-header)
DB_PASS=$(doctl databases user get "$DB_ID" tg_api --format Password --no-header)
export DO_DATABASE_URL="postgresql://tg_api:${DB_PASS}@${DB_HOST}:${DB_PORT}/technograph?sslmode=require"

pg_dump "$SUPABASE_DIRECT_URL" --data-only --schema=public \
  --no-owner --no-privileges --column-inserts -f supabase-data.sql
psql "$DO_DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f supabase-data.sql
rm supabase-data.sql

# Remove the temporary firewall rule (find its UUID in the list output).
doctl databases firewalls list "$DB_ID"
doctl databases firewalls remove "$DB_ID" --uuid <rule-uuid>
```

`--data-only` inserts tables in dependency order and resets sequences. If the
restore fails on a foreign-key cycle, insert `SET CONSTRAINTS ALL DEFERRED;`
as the first line of `supabase-data.sql` and re-run. **Do not run `db:seed`**
when copying data — the dump already contains the seeded tenant.

If you ever start from an empty database instead, seed once:

```bash
doctl apps console <tg-api app id> api     # opens a shell in the running container
node dist/db/seed.js
```

## 5. First UI deploy

```bash
cd tg-ui
gh variable set API_ORIGIN --body "https://tg-api-xxxxx.ondigitalocean.app"
git push origin main
doctl apps list --format Spec.Name,DefaultIngress    # note the tg-ui URL
```

## 6. Close the loop

```bash
cd tg-api
gh variable set APP_URL      --body "https://tg-ui-xxxxx.ondigitalocean.app"
gh variable set CORS_ORIGINS --body "https://tg-ui-xxxxx.ondigitalocean.app"
gh workflow run deploy.yml
```

`APP_URL` is what invite / reset magic links point at; `CORS_ORIGINS` is the
allow-list for any direct browser → API calls.

## 7. Verify

1. Open the tg-ui URL → redirected to `/login`.
2. Sign in as an existing user → lands on `/employer` or `/portal`.
3. Account & security → "Email me a reset link" → the link points at the
   tg-ui URL. With no `RESEND_API_KEY`, the link is printed in the tg-api
   runtime logs (`doctl apps logs <id> api --type run`).

## Day-to-day

- **Deploy**: merge/push to `main`. CI must be green; the deploy job waits for
  App Platform to finish and fails the workflow if the build, migrate job, or
  health check fails (the previous version keeps serving).
- **Schema change**: `npm run db:generate` locally, commit the new
  `drizzle/*.sql`, push. The PRE_DEPLOY job applies it before the new API
  version starts.
- **Change `API_ORIGIN`**: it is baked into the UI build — update the GitHub
  variable and re-run the UI deploy.
- **Custom domain**: add a `domains:` block to the app spec
  (`- domain: app.example.com, type: PRIMARY`), push, then update
  `APP_URL` / `CORS_ORIGINS` on the API and redeploy.
- **Logs**: `doctl apps logs <id> api --type run --follow`
  (`--type build` / `--type deploy` for the others; component `migrate` for
  the job).
- **HTTPS** is required (the cookie is `Secure` in production); App Platform
  provides it.
````

- [ ] **Step 2: README pointer**

In `tg-api/README.md`, immediately after the "Stack & conventions" table (before the next `##` heading), insert:

```markdown
## Deployment

Runs on DigitalOcean App Platform with Managed Postgres, deployed by GitHub
Actions on push to `main`. See [docs/DEPLOY.md](docs/DEPLOY.md).
```

Also change the table row `| Database | Supabase Postgres via **Drizzle ORM** (`postgres-js` driver) |` to `| Database | Postgres (DigitalOcean Managed) via **Drizzle ORM** (`postgres-js` driver) |`.

- [ ] **Step 3: Mirror to the workspace root and commit**

```bash
cp /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-api/docs/DEPLOY.md /Users/satishreddy/Desktop/CurrentDevelopment/new/DEPLOY.md
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-api
git add docs/DEPLOY.md README.md
git commit -m "docs: DigitalOcean deployment runbook

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Final verification pass (both repos)

- [ ] **Step 1: API full check**

```bash
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-api
npm run typecheck && npm test && npm run build && docker build -q -t tg-api:local . && git status --short
```

Expected: all green, image builds, working tree clean.

- [ ] **Step 2: UI full check**

```bash
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-ui
API_ORIGIN=https://placeholder.invalid npm run build \
  && docker build -q --build-arg API_ORIGIN=http://localhost:4000 -t tg-ui:local . \
  && git status --short
```

Expected: build succeeds, image builds, working tree clean.

- [ ] **Step 3: Confirm no Railway/Vercel/Supabase leftovers**

```bash
cd /Users/satishreddy/Desktop/CurrentDevelopment/new
grep -rn -i "railway\|vercel\|supabase\|DIRECT_DATABASE_URL" tg-api tg-ui --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist --exclude-dir=.git --exclude-dir=docs
```

Expected: no matches except (a) the Supabase step in `DEPLOY.md` (excluded via `docs`) and (b) `tg-ui/.gitignore`'s `.vercel` line, which is harmless. Fix anything else found.

---

### Task 11: Push and bootstrap (pauses for the user)

These steps are outward-facing or billable. Do everything up to the pause, then stop and report.

- [ ] **Step 1: Show the user what is about to happen and ask for a go**

Present: the two `git push` commands, the `doctl databases create` command (~$15/mo), and the list of secrets/variables that need values only the user has (`DIGITALOCEAN_ACCESS_TOKEN`, `RESEND_API_KEY`, the Supabase direct URL). Wait for confirmation.

- [ ] **Step 2 (after go): push both repos**

```bash
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-api && git push origin main
cd /Users/satishreddy/Desktop/CurrentDevelopment/new/tg-ui  && git push origin main
```

Note: the first Deploy runs will be red until secrets exist. That is expected.

- [ ] **Step 3 (after go): follow `docs/DEPLOY.md` steps 1–7 with the user**, running the `doctl`/`gh` commands that need no user-only values, and asking the user to run the ones that do (token, Resend key, Supabase URL). Report the final API and UI URLs and the `/health` result.
