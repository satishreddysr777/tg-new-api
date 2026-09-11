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

# Postgres 15+ no longer lets ordinary users create objects in `public`, and
# the migrator also creates the `drizzle` schema. Grant both to tg_api once
# (doadmin owns the database it created, so GRANT always works; ALTER OWNER
# would not).
# (Works now because the cluster has no firewall rules yet; after step 3 locks
# it to the app, add your IP as in step 4 before running psql again.)
ADMIN_URI=$(doctl databases connection "$DB_ID" --format URI --no-header | sed 's#/defaultdb#/technograph#')
psql "$ADMIN_URI" -v ON_ERROR_STOP=1 \
  -c "GRANT ALL ON DATABASE technograph TO tg_api;" \
  -c "GRANT ALL ON SCHEMA public TO tg_api;"
```

The app spec attaches the cluster by name (`cluster_name: tg-postgres`,
`db_name: technograph`, `db_user: tg_api`) and App Platform injects
`DATABASE_URL` and the CA certificate (`DATABASE_CA_CERT`) into the API.

Attaching does **not** restrict who can connect: a new cluster with no
firewall rules accepts every IP. After the first API deploy (step 3), lock it
down to the app only:

```bash
APP_ID=$(doctl apps list --format ID,Spec.Name --no-header | awk '$2=="tg-api"{print $1}')
doctl databases firewalls append "$DB_ID" --rule "app:${APP_ID}"
doctl databases firewalls list "$DB_ID"     # expect one rule of type app
```

## 2. GitHub secrets and variables

API repo:

```bash
cd tg-api
gh secret set DIGITALOCEAN_ACCESS_TOKEN      # paste the token from step 0.1
gh secret set JWT_SECRET                     # the openssl value
# RESEND_API_KEY: skip unless you have a key (unset ⇒ empty ⇒ links are logged); to set one: gh secret set RESEND_API_KEY
gh variable set UI_URL       --body "https://placeholder"
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
doctl apps list --format ID,Spec.Name,DefaultIngress
curl https://tg-api-xxxxx.ondigitalocean.app/health   # {"status":"ok",...}
```

## 4. Copy data from Supabase (one time)

Run **after** step 3 so the schema and migration history already exist.

```bash
# The cluster is locked to the app (step 1), so allow this machine temporarily.
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

# Remove the temporary firewall rule (the append command printed its UUID;
# `doctl databases firewalls list "$DB_ID"` shows it too).
doctl databases firewalls remove "$DB_ID" --uuid <rule-uuid>
```

`--data-only` inserts tables in dependency order and resets sequences. If the
restore ever fails on foreign-key ordering, re-run the `pg_dump` with
`--disable-triggers` added (works because `tg_api` owns the tables) and
restore again. **Do not run `db:seed`** when copying data — the dump already
contains the seeded tenant.

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
doctl apps list --format ID,Spec.Name,DefaultIngress    # note the tg-ui URL
```

## 6. Close the loop

```bash
cd tg-api
gh variable set UI_URL       --body "https://tg-ui-xxxxx.ondigitalocean.app"
gh variable set CORS_ORIGINS --body "https://tg-ui-xxxxx.ondigitalocean.app"
gh workflow run deploy.yml
```

`APP_URL` is what invite / reset magic links point at (set via the `UI_URL`
repo variable); `CORS_ORIGINS` is the allow-list for any direct browser → API
calls.

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
