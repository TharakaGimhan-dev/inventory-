# Inventory SaaS

Multi-tenant office asset register, sold as a subscription. Built for Sri Lankan
SMEs; successor to the single-organisation **TS Asset Register**.

**[`SAAS_SPEC.md`](SAAS_SPEC.md) is the single source of truth — read it before changing anything.**

**Current state: Phase 6 complete.** The whole product: capture, register,
offline sync, plans, payments, exports, QR labels, bulk import and API keys. Only
the marketing site and onboarding (Phase 7) remain. PayHere's field names and
hash formulas still need verifying against a live merchant account — see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#before-taking-real-money).

| | |
|---|---|
| Web | Next.js 16 PWA — mobile capture, register, offline outbox |
| API | NestJS 11 — Sequelize on PostgreSQL, Redis for sessions and idempotency |
| Host | Railway — `web`, `api`, `postgres`, `redis` |
| Payments | PayHere, behind a provider interface — webhook-verified, exactly-once |
| Tests | 70 API tests + 45 browser checks, all against real Postgres and Redis |
| Security | Reviewed against OWASP Top 10:2025; 0 dependency vulnerabilities |

## Documentation

| Document | What it covers |
|---|---|
| [`SAAS_SPEC.md`](SAAS_SPEC.md) | Architecture, tenancy, data model, plans, phase plan. The source of truth. |
| [`apps/api/README.md`](apps/api/README.md) | The API: modules, isolation, auth, quotas, migrations. |
| [`apps/web/README.md`](apps/web/README.md) | The web app: the proxy, offline capture, upgrade prompts. |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Railway, step by step, and what breaks if you skip a step. |
| [`docs/TESTING.md`](docs/TESTING.md) | What is tested, how to run it, and what each suite protects. |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Review against OWASP Top 10:2025, what defends what, and the gaps that remain. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Conventions, and the rules that must not be broken. |
| [`CHANGELOG.md`](CHANGELOG.md) | What each phase delivered. |

## Layout

```
apps/
  api/               NestJS API
    src/configs/     database, redis, env validation
    src/common/      guards, pipes, decorators, tenant context and query hook
    src/modules/     auth, tenant, user, asset, audit, billing, health
    migrations/      schema changes, run before every deploy
    tests/           isolation, asset register, quota
  web/               Next.js PWA
    app/(auth)/      login
    app/(app)/       register, capture, billing, more
    lib/             api client, auth, offline outbox
    tests/           browser end-to-end checks
docs/                deployment and testing guides
```

## Running locally

Postgres and Redis:

```bash
docker compose up -d
```

The API:

```bash
cd apps/api
npm install
cp .env.example .env
```

Generate the two JWT secrets and put them in `.env` — they must differ:

```bash
openssl rand -base64 48
```

```bash
npm run migrate
npm run seed
npm run start:dev
```

The web app, in a second terminal:

```bash
cd apps/web
npm install
cp .env.local.example .env.local
npm run dev
```

| | |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:3001/api/v1 |
| Health | http://localhost:3001/api/v1/health |
| Swagger | http://localhost:3001/docs (development only) |

There is no seeded login. Create the first account:

```bash
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.lk","password":"a-long-password","firstName":"Your","lastName":"Name","organisationName":"Your Company"}'
```

## The four things that must stay true

Everything else is ordinary application code. These four are load-bearing, and
each has tests that fail loudly if it stops holding.

**One tenant can never see another's data.** Enforced in three layers so it does
not depend on anyone remembering a `where` clause — schema, request context, and
a Sequelize hook that injects `tenantId` into every query and throws when there
is no tenant. See [`apps/api/README.md`](apps/api/README.md#tenant-isolation).

**Asset codes are gapless and never reused.** A code is printed on a label and
stuck to equipment. Reissuing one makes the label point at two things.

**Audit entries cannot be changed or deleted.** Not by any role, through any code
path. The controller has no write route and the model refuses `update` and
`destroy`.

**Plan limits are enforced where they are counted, not where they are checked.**
A guard that reads a counter and then acts cannot hold a limit when several
requests arrive at once. The increment itself carries the condition.

**Only a verified webhook can activate a subscription, and only once.** A return
URL is a navigation, not a payment. Providers retry, and a retry applied twice
bills a customer twice.

**Export is never blocked.** At any subscription state and on any plan, a
customer can take their data and leave. CSV is written by hand rather than
through a library, so the one promise that matters most has no dependency to
break.

## Deploying

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Four Railway services; `postgres`
and `redis` must not have public domains.

## Licence

Private and unlicensed. All rights reserved.
