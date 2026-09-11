# DigitalOcean deployment for Technograph (tg-ui + tg-api)

**Date:** 2026-09-11
**Status:** approved
**Scope:** migrate hosting from Vercel (UI) + Railway (API) + Supabase (DB) to
DigitalOcean App Platform (UI, API) + DigitalOcean Managed Postgres, with a
GitHub Actions CI/CD pipeline per repository.

This spec covers two repositories that are deployed independently:

| Repo | GitHub | Local folder | Service |
| --- | --- | --- | --- |
| tg-api | `satishreddysr777/tg-new-api` | `tg-api/` | Fastify + Drizzle API |
| tg-ui | `satishreddysr777/tg-new-ui` | `tg-ui/` | Next.js 14 web app |

`tg-api-legacy-under-developed/` is dead code and is out of scope.

## 1. Goals and non-goals

Goals

- Two independent DigitalOcean App Platform apps, `tg-api` and `tg-ui`, each
  deployed from its own repo on push to `main`.
- A visible CI gate in GitHub (typecheck, tests, build) before any deploy.
- Database on DigitalOcean Managed Postgres, with schema migrations applied
  automatically before each API deploy.
- Existing Supabase data copied to the new database once.
- Vercel / Railway / Supabase-specific configuration removed.

Non-goals

- Custom domains (default `*.ondigitalocean.app` URLs for now; the app specs
  can gain a `domains:` block later).
- PR preview environments.
- Changing application behaviour, auth, or email flows.

## 2. Topology

```
Browser ──► App Platform "tg-ui"  (Next.js, Dockerfile, 1× basic-xxs)
                 │  server-side rewrite of /api/v1/*  (API_ORIGIN)
                 ▼
            App Platform "tg-api" (Fastify, Dockerfile, 1× basic-xxs)
                 ├─ job "migrate"  kind PRE_DEPLOY  → node dist/db/migrate.js
                 └─► Managed Postgres cluster "tg-postgres"
                     (engine pg 16, db-amd-1vcpu-1gb, 1 node, region nyc3)
```

- The browser only talks to the UI origin. Next.js proxies `/api/v1/*` to the
  API so the `tg_session` cookie stays first-party. This is unchanged.
- `JWT_SECRET` and `SESSION_COOKIE_NAME` must be identical on both apps. This
  is unchanged.
- The database is a standalone production cluster (not an App Platform "dev
  database"), so it is not deleted with the app. The API app is attached to it
  as a trusted source via the spec's `databases:` block.
- Both apps run in region `nyc` (App Platform) / `nyc3` (database).

## 3. Build: Dockerfiles

Both apps build from a Dockerfile instead of the Node buildpack. This avoids
the buildpack's devDependency pruning (the `tsc: not found` problem hit on
Railway) and gives a reproducible image. Base image: `node:20-alpine`.

### 3.1 tg-api/Dockerfile

Multi-stage:

1. `deps`: `npm ci` (all deps).
2. `build`: copy source, `npm run build` (tsc → `dist/`).
3. `runtime`: `npm ci --omit=dev`, copy `dist/` and `drizzle/`, `USER node`,
   `CMD ["node", "dist/server.js"]`. `drizzle/` is required at runtime by the
   migration job (see §4.2).

`.dockerignore` excludes `node_modules`, `dist`, `.env*`, `test`, `docs`,
`.git`.

The API listens on `HOST=0.0.0.0` and the `PORT` App Platform injects (the
config schema already reads `PORT`). Health check: `GET /health`.

### 3.2 tg-ui/Dockerfile

`next.config.mjs` gains `output: "standalone"`. Multi-stage:

1. `deps`: `npm ci`.
2. `build`: `npm run build` with `API_ORIGIN` available as a build arg (App
   Platform passes `RUN_AND_BUILD_TIME`-scoped envs to Docker builds as build
   args and the Dockerfile declares it with `ARG`/`ENV`). `JWT_SECRET` and
   `SESSION_COOKIE_NAME` are deliberately not build args: Next 14 middleware
   reads them from the runtime environment (verified: the secret literal is
   absent from the built image and a runtime-supplied secret is honoured).
3. `runtime`: copy `.next/standalone`, `.next/static`, `public`;
   `USER node`; `CMD ["node", "server.js"]`. The standalone server honours
   `PORT` and `HOSTNAME=0.0.0.0`.

`API_ORIGIN` is read at build time by `next.config.mjs` rewrites, so changing
it requires a redeploy (unchanged behaviour, now documented for DO).

## 4. Database

### 4.1 Cluster

Created once with doctl (documented in DEPLOY.md, not automated in CI):

```
doctl databases create tg-postgres --engine pg --version 16 \
  --region nyc3 --size db-amd-1vcpu-1gb --num-nodes 1
```

A dedicated database `technograph` and user `tg_api` are created on the
cluster. The app spec references the cluster by name and DO injects the
connection details as bindable variables.

### 4.2 API changes

- **New `src/db/migrate.ts`** — programmatic migrator using
  `drizzle-orm/postgres-js/migrator`'s `migrate()` with
  `migrationsFolder: "drizzle"`. It uses the same journal
  (`drizzle/meta/_journal.json`) and the same `drizzle.__drizzle_migrations`
  tracking table as `drizzle-kit migrate`, so existing history is preserved.
  It opens its own `postgres` client with `max: 1`, runs, closes, and exits
  non-zero on failure. Compiled to `dist/db/migrate.js`; run by the
  PRE_DEPLOY job as `node dist/db/migrate.js`. No devDependencies needed at
  runtime.
- **`DATABASE_CA_CERT`** (optional string env) — DO's cluster CA, injected as
  `${db.CA_CERT}`. A small pure helper `src/db/ssl.ts` (`sslOptions(caCert)`)
  returns `{ ca, rejectUnauthorized: true }` when a cert is given and
  `undefined` otherwise; `src/db/client.ts` and `migrate.ts` both spread its
  result into the `postgres()` options. When unset,
  behaviour is unchanged (the URL's `sslmode` still applies), so local dev
  and tests are unaffected.
- **`drizzle.config.ts`** — drop the `DIRECT_DATABASE_URL` preference; use
  `DATABASE_URL`. drizzle-kit is now used only for local `db:generate` /
  `db:studio`; the `db:migrate` script is changed to `node dist/db/migrate.js`
  (after `npm run build`) so local and production run the same code.
- `prepare: false` stays on the client. DO has no transaction pooler in this
  setup, but leaving it on is harmless and keeps the change small.
- Env docs (`.env.example`, `.env.production.example`) updated: remove
  `DIRECT_DATABASE_URL`, add `DATABASE_CA_CERT`.

### 4.3 One-time data copy from Supabase

Documented in DEPLOY.md and run by hand, after the first API deploy has
applied the schema (so tables exist and `__drizzle_migrations` is correct):

```
# 1. dump data only, public schema only, from Supabase (direct 5432 URL)
pg_dump "$SUPABASE_DIRECT_URL" --data-only --schema=public \
  --no-owner --no-privileges --column-inserts -f supabase-data.sql
# 2. restore into DO (connection string from doctl databases connection)
psql "$DO_DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f supabase-data.sql
```

`--data-only` restores in dependency order and resets sequences. If a
foreign-key cycle blocks the restore, the fallback is to edit the dump to
defer constraints (`SET CONSTRAINTS ALL DEFERRED`) — noted in DEPLOY.md. The
seed (`db:seed`) is **not** run when copying data, since it would duplicate
the demo tenant already present in the dump.

## 5. App specs

Each repo carries `.do/app.yaml`. Secrets are never committed: the spec uses
`${NAME}` placeholders which the deploy action expands from the GitHub
Actions environment; DO stores values marked `type: SECRET` encrypted. DO's
own bindables (`${db.DATABASE_URL}`, `${db.CA_CERT}`) are left
intact by the action.

### 5.1 tg-api/.do/app.yaml (shape)

```yaml
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
    github: { repo: satishreddysr777/tg-new-api, branch: main, deploy_on_push: false }
    http_port: 8080
    instance_size_slug: basic-xxs
    instance_count: 1
    health_check: { http_path: /health }
    envs:
      - { key: NODE_ENV, value: production }
      - { key: PORT, value: "8080" }
      - { key: LOG_LEVEL, value: info }
      - { key: DATABASE_URL, value: "${db.DATABASE_URL}", type: SECRET }
      - { key: DATABASE_CA_CERT, value: "${db.CA_CERT}", type: SECRET }
      - { key: JWT_SECRET, value: "${JWT_SECRET}", type: SECRET }
      - { key: RESEND_API_KEY, value: "${RESEND_API_KEY}", type: SECRET }
      - { key: APP_URL, value: "${UI_URL}" }
      - { key: CORS_ORIGINS, value: "${CORS_ORIGINS}" }
      - { key: MAIL_FROM, value: "${MAIL_FROM}" }
      - { key: MFA_ENABLED, value: "false" }
      - { key: SESSION_COOKIE_NAME, value: tg_session }
jobs:
  - name: migrate
    kind: PRE_DEPLOY
    dockerfile_path: Dockerfile
    github: { repo: satishreddysr777/tg-new-api, branch: main, deploy_on_push: false }
    run_command: node dist/db/migrate.js
    instance_size_slug: basic-xxs
    envs:
      - { key: NODE_ENV, value: production }
      - { key: DATABASE_URL, value: "${db.DATABASE_URL}", type: SECRET }
      - { key: DATABASE_CA_CERT, value: "${db.CA_CERT}", type: SECRET }
      - { key: JWT_SECRET, value: "${JWT_SECRET}", type: SECRET }
```

`deploy_on_push: false` on both components: only the GitHub workflow deploys.
The job needs `JWT_SECRET` only because `config/env` validates it at import
(min length 16); a placeholder would work but reusing the real one is simpler.

### 5.2 tg-ui/.do/app.yaml (shape)

```yaml
name: tg-ui
region: nyc
services:
  - name: web
    dockerfile_path: Dockerfile
    github: { repo: satishreddysr777/tg-new-ui, branch: main, deploy_on_push: false }
    http_port: 3000
    instance_size_slug: basic-xxs
    instance_count: 1
    health_check: { http_path: /login }
    envs:
      - { key: NODE_ENV, value: production }
      - { key: PORT, value: "3000" }
      - { key: HOSTNAME, value: 0.0.0.0 }
      - { key: API_ORIGIN, value: "${API_ORIGIN}", scope: RUN_AND_BUILD_TIME }
      - { key: JWT_SECRET, value: "${JWT_SECRET}", type: SECRET, scope: RUN_TIME }
      - { key: SESSION_COOKIE_NAME, value: tg_session, scope: RUN_TIME }
```

`NEXT_PUBLIC_API_URL` stays unset so the browser uses the same-origin proxy.

## 6. CI/CD: GitHub Actions (per repo)

### 6.1 `.github/workflows/ci.yml` — pull requests to `main`

- `actions/checkout`, `actions/setup-node@v4` (node 20, npm cache), `npm ci`.
- tg-api: `npm run typecheck`, `npm test`, `npm run build`.
- tg-ui: `npm run build` (with a placeholder `API_ORIGIN` so the build is
  deterministic). `next build` already type-checks, so no
  separate `tsc` step.
- Lint is **not** run: neither repo has an ESLint config, and the API's
  `lint` script has no eslint dependency. Adding lint is out of scope.

### 6.2 `.github/workflows/deploy.yml` — push to `main`

1. Same checks as CI (a job `checks`).
2. Job `deploy` (`needs: checks`, `concurrency: deploy-<app>` with
   `cancel-in-progress: false`):
   `digitalocean/app_action/deploy@v2` with
   `token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}`,
   `app_spec_location: .do/app.yaml`, `print_build_logs: true`,
   `print_deploy_logs: true`. The step's `env:` block maps GitHub
   secrets/variables to the `${NAME}` placeholders in the spec.
   The action creates the app on first run and updates it afterwards, and
   fails the workflow if the deployment fails (including a failed migrate
   job), so a bad deploy is red in GitHub.
3. `workflow_dispatch` is also enabled so a deploy can be re-run by hand.

### 6.3 GitHub configuration

| Repo | Secrets | Variables |
| --- | --- | --- |
| tg-new-api | `DIGITALOCEAN_ACCESS_TOKEN`, `JWT_SECRET`, `RESEND_API_KEY` (may be empty) | `UI_URL`, `CORS_ORIGINS`, `MAIL_FROM` |
| tg-new-ui  | `DIGITALOCEAN_ACCESS_TOKEN`, `JWT_SECRET` | `API_ORIGIN` |

The DO token needs read/write scope for apps and databases. The GitHub
App Platform integration must be authorised once for both repos (DO console
→ Apps → GitHub) so App Platform can pull the source.

## 7. Bootstrap order (DEPLOY.md)

App URLs are unknown until first deploy, so setup is two-pass:

1. Create the Postgres cluster, database and user (§4.1). Attaching the
   cluster in the app spec adds the API app as a trusted source automatically.
2. Generate `JWT_SECRET` once (`openssl rand -hex 32`); set it in both repos.
3. Set API repo variables with placeholders (`UI_URL=https://placeholder`,
   `CORS_ORIGINS=https://placeholder`). Push `main` → API deploys, migrate
   job creates the schema. Note the API URL from the action output or
   `doctl apps list`.
4. Copy data from Supabase (§4.3).
5. Set UI repo variable `API_ORIGIN=<api url>`. Push `main` → UI deploys.
   Note the UI URL.
6. Set API repo variables `UI_URL` and `CORS_ORIGINS` to the UI URL. Re-run
   the API deploy workflow (`workflow_dispatch`).
7. Verify: `curl <api>/health`; open `<ui>` → `/login`; sign in; request a
   reset link and confirm it points at the UI URL.

## 8. File changes

tg-api

- add `Dockerfile`, `.dockerignore`, `.do/app.yaml`,
  `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`,
  `src/db/migrate.ts`, `src/db/ssl.ts`, `test/ssl.test.ts`,
  `docs/superpowers/specs/…` (this file)
- modify `src/config/env.ts` (add `DATABASE_CA_CERT`), `src/db/client.ts`
  (ssl option), `drizzle.config.ts`, `package.json` (`db:migrate` script),
  `.env.example`, `.env.production.example`, `README.md` (deploy pointer)
- delete `railway.json`, `nixpacks.toml`

tg-ui

- add `Dockerfile`, `.dockerignore`, `.do/app.yaml`,
  `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`
- modify `next.config.mjs` (`output: "standalone"`),
  `.env.production.example`

Workspace root

- rewrite `DEPLOY.md` for DigitalOcean (kept at the root, mirrored as
  `tg-api/docs/DEPLOY.md` so it is versioned).

## 9. Testing and verification

- Existing vitest suite runs in CI and before every deploy.
- `src/db/migrate.ts` gets a unit test only for its SSL-option builder (pure
  function shared with `client.ts`); the migration itself is exercised by the
  PRE_DEPLOY job.
- Each Dockerfile is verified locally with `docker build` and, for the API,
  `docker run` against a placeholder env to confirm `/health` responds.
- Workflow YAML validated with `actionlint` if available, otherwise by a
  dry PR run.
- End-to-end: the bootstrap checklist in §7.

## 10. Error handling

- Invalid env → API refuses to start (existing `env-schema` behaviour);
  App Platform health check fails and the deploy is rolled back, red in
  GitHub.
- Migration failure → PRE_DEPLOY job exits non-zero, deploy aborts, previous
  version keeps serving.
- Deploy action failure → workflow red; `workflow_dispatch` re-runs it.
- Concurrency group prevents two deploys of the same app overlapping.
