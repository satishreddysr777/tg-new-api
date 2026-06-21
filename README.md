# tg-api

Backend for the **Technograph** employee portal & console — built with
**Fastify 5 + TypeScript**.

It currently powers the authentication flow used by the `tg-ui` login screens:
sign in, create account, 2-factor verification, and password reset.

## Stack & conventions

| Concern | Choice |
|---|---|
| HTTP framework | Fastify 5 (no NestJS) |
| Database | Supabase Postgres via **Drizzle ORM** (`postgres-js` driver) |
| Validation & types | TypeBox via `@fastify/type-provider-typebox` (one schema = runtime validation + static types) |
| Auth | `@fastify/jwt` (Bearer access tokens) + bcrypt password hashing |
| Config | Env validated at boot with `env-schema` — invalid env → no start |
| Security | helmet, CORS allow-list, global + per-route rate limits |
| Errors | Domain error hierarchy → centralized handler → consistent JSON |
| Docs | OpenAPI + Swagger UI at `/docs` (non-prod) |
| Logging | pino (pretty in dev) |
| Lifecycle | `close-with-grace` for graceful shutdown |
| Tests | Vitest + `app.inject()` (no live socket needed) |

## Project layout

A flat **layered** architecture (not NestJS modules) — files grouped by their
role, dependencies pointing inward: routes → services → repositories → domain.

```
src/
  server.ts                 # bootstrap + graceful shutdown
  app.ts                    # composition root: buildApp({ userRepository? })
  config/
    env.ts                  # validated runtime config
    typebox-formats.ts      # custom string-format registration
  db/
    schema.ts               # Drizzle table definitions (source of truth)
    client.ts               # postgres-js connection + drizzle instance
    seed.ts                 # `npm run db:seed`
  plugins/                  # cross-cutting Fastify plugins
    config · error-handler · security · jwt · swagger
  routes/                   # HTTP layer (Fastify route plugins)
    auth.routes.ts · health.routes.ts
  services/                 # use-cases / business logic (transport-agnostic)
    auth.service.ts
  repositories/             # data access
    user.repository.ts      # Drizzle + in-memory implementations
    challenge.store.ts      # in-memory 2FA challenge store
  schemas/                  # TypeBox request/response contracts
    auth.schemas.ts
  domain/                   # entities & shared types
    user.ts
  lib/                      # framework-free helpers (errors, password)
drizzle/                    # generated SQL migrations
test/                       # vitest integration tests
```

The **service layer is transport-agnostic** — it throws domain errors and
receives the JWT signer by injection, so it has no dependency on Fastify or
HTTP status codes. The **user repository is an interface** with two
implementations: `DrizzleUserRepository` (Supabase Postgres) for runtime and
`InMemoryUserRepository` for tests. `buildApp({ userRepository })` injects the
store, so tests never touch a live database.

## Quick start

```bash
npm install
cp .env.example .env          # set DATABASE_URL to your Supabase connection string

npm run db:push               # create the schema in Supabase (or db:migrate)
npm run db:seed               # insert the demo employee

npm run dev                   # http://localhost:4000  · docs at /docs
```

### Database (Supabase + Drizzle)

The schema lives in [`src/db/schema.ts`](src/db/schema.ts). Workflow:

```bash
npm run db:generate   # diff schema → SQL migration in ./drizzle
npm run db:migrate    # apply migrations            (direct connection, :5432)
npm run db:push       # push schema directly (dev)  (direct connection, :5432)
npm run db:studio     # browse data in Drizzle Studio
npm run db:seed       # idempotent demo seed
```

> Run migrations against the **direct** connection (port 5432). The app itself
> uses the **transaction pooler** (port 6543, `prepare: false`) at runtime.
> In non-production, `buildApp` also best-effort seeds the demo user on boot.

Build & run:

```bash
npm run build && npm start
npm run typecheck
npm test
```

## API (`/api/v1`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | Verify credentials → issue a 2FA challenge |
| POST | `/auth/register` | Create account → issue a 2FA challenge |
| POST | `/auth/verify` | Exchange a 6-digit code for an access token |
| POST | `/auth/forgot-password` | Request a reset link (never reveals existence) |
| GET | `/auth/me` | Current user (Bearer-protected) |
| GET | `/health` | Liveness/readiness probe |

**Seeded demo user** (matches the pre-filled UI credentials):
`renee.boateng@technograph.io` / `renee-password`. In dev, the 2FA code is
logged at `debug` so you can complete the flow without an SMS provider.

### Example

```bash
# 1) login → challengeId
curl -s localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"renee.boateng@technograph.io","password":"renee-password","role":"EMPLOYEE"}'

# 2) verify (use the code printed in the server logs)
curl -s localhost:4000/api/v1/auth/verify \
  -H 'content-type: application/json' \
  -d '{"challengeId":"<id>","code":"<code>"}'
```

## Security notes

- Login and registration return an identical "challenge" shape, and reset
  always returns `{ sent: true }` — no email enumeration.
- Password verification runs even for unknown emails to blunt timing analysis.
- 2FA codes are single-use, expire (`MFA_CHALLENGE_TTL_SECONDS`), and lock
  after 5 attempts.
- `JWT_SECRET` must be overridden in production or the process refuses to boot.

> Users are persisted in Supabase Postgres via Drizzle. The 2FA **challenge**
> store is still in-memory (it's short-lived, TTL'd state) — back it with Redis
> for multi-instance production deployments.
