# Inventory SaaS

Multi-tenant office asset & inventory register, sold as a subscription.

**`SAAS_SPEC.md` is the single source of truth — read it before changing anything.**

**Current state: Phase 1 (Tenancy & auth) complete.** Registration, login, refresh
tokens, tenant switching, roles, and the tenant-isolation layer are live and tested.
The asset register itself is Phase 2.

## Layout

```
apps/api/            NestJS API
  src/configs/       database, redis, env validation
  src/modules/       auth, tenant, user, billing, health
  src/common/        guards, pipes, decorators shared across modules
  migrations/        schema changes, run before every deploy
  config/            sequelize-cli config (the CLI cannot read Nest's)
  tests/isolation/   the tenant-isolation suite - spec §3.2
docker-compose.yml   local Postgres + Redis
SAAS_SPEC.md         architecture, data model, plans, phases
```

## Running locally

Postgres and Redis first:

```bash
docker compose up -d
```

Then the API:

```bash
cd apps/api
npm install
cp .env.example .env
```

Generate the two JWT secrets and paste them into `.env` — they must be different values:

```bash
openssl rand -base64 48
```

Apply migrations, then start:

```bash
npm run migrate
npm run start:dev
```

- API — http://localhost:3001/api/v1
- Health — http://localhost:3001/api/v1/health
- Swagger — http://localhost:3001/docs (development only; closed in production)

## Tenant isolation

The one thing that must never fail. Three layers, described in spec §3.1:

| Layer | Where | What it does |
|---|---|---|
| Schema | `migrations/` | `tenantId NOT NULL`, composite unique keys (`UNIQUE (tenantId, code)`, never `UNIQUE (code)`) |
| Context | `common/context/tenant.context.ts` | `AsyncLocalStorage` holds the tenant from the **verified token** — never a header, query param or body field |
| Query | `common/services/tenant-scope.hook.ts` | Sequelize hooks inject `tenantId` into every read and write, and throw when no tenant is in context |

The third layer is what makes the guarantee hold: it does not depend on anyone
remembering `where: { tenantId }`. A query naming another tenant is **rejected**, not
quietly rewritten, and a query with no tenant at all raises rather than returning
every customer's rows.

`runWithoutTenantScope()` is the only way across, reserved for audited
platform-admin work. Finding every bypass is one grep.

```bash
npm run test:isolation
```

Needs a running Postgres (`docker compose up -d`) — the suite tests that real
Sequelize hooks fire, which a mock cannot prove.

## Auth

- Access token 15 min, refresh token 30 days, both httpOnly cookies (body too, for
  mobile and API clients).
- Redis is the source of truth for live sessions, so a signed but revoked token
  stops working. Refresh rotates the session id, so a leaked refresh token cannot
  be replayed after the real user has used it.
- Every route requires a token unless marked `@Public()` — new routes are protected
  by default.
- Roles are ranked, so `@Roles(ADMIN)` admits `owner` without listing it.
- Login compares against a dummy hash when the account does not exist, so response
  timing cannot be used to enumerate customers.

## Health checks

Two endpoints, deliberately separate:

| Route | Checks | Use |
|---|---|---|
| `/api/v1/health` | Postgres + Redis | Railway's deploy gate. 503 if either is down. |
| `/api/v1/health/live` | nothing | Liveness. Stays 200 while the process is alive. |

A restart should be triggered by the process being wedged, not by Postgres having a
bad minute — which is why liveness does not touch dependencies.

## Migrations

`synchronize` is **off**. It drops columns it does not recognise, which is fine in a
scratch project and unacceptable with customer data. Every schema change is a migration.

```bash
npm run migration:create -- add-tenants-table
npm run migrate
npm run migrate:status
npm run migrate:undo
```

Migrations run as Railway's pre-deploy command, so a migration that fails stops the
deploy and the previous version keeps serving.

## Deploying to Railway

Four services in one project:

```
web (Next.js)  →  api (NestJS)  →  postgres
                        ↓
                      redis
```

`postgres` and `redis` must **not** have a public domain — they are reached over
Railway's private network. `api` and `web` need one.

For the `api` service:

1. Root directory — `apps/api`
2. `railway.json` supplies build, start, pre-deploy and the health check path.
3. Variables — reference the service, never paste the value, so a rotated password
   does not silently break the deploy:

   ```
   NODE_ENV=production
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   JWT_ACCESS_SECRET=<openssl rand -base64 48>
   JWT_REFRESH_SECRET=<a different one>
   CORS_ORIGINS=https://<your web domain>
   ```

4. Settings → Networking → Generate Domain.

The app binds `0.0.0.0` and reads Railway's `PORT`. Binding the default instead listens
only inside the container, and the health check then fails every deploy.

`IMAGEKIT_PRIVATE_KEY`, `PAYHERE_SECRET` and both JWT secrets are API-only and must never
gain a `NEXT_PUBLIC_` prefix — that prefix ships the value to the browser.

## Next

**Phase 1 — Tenancy & auth:** tenants, users, memberships, JWT + refresh tokens, the
roles guard, and the Sequelize tenant-scope hook. Done when the tenant-isolation suite
in spec §3.2 passes — one tenant must not be able to read, write or even detect another's
data, and that must hold without a developer remembering a `where` clause.
