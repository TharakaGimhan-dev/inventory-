# API

NestJS + Sequelize on PostgreSQL, Redis for sessions and idempotency.

Structure follows one shape per module: `models/` → `schemas/` → `service/` →
`controller/`. A new feature adds a folder under `src/modules/`, not a new pattern.

## Running

Needs Postgres and Redis (`docker compose up -d` at the repo root).

```bash
npm install
cp .env.example .env     # then generate the two JWT secrets
npm run migrate
npm run seed             # the plan catalogue
npm run start:dev
```

Swagger is at `/docs` in development and closed in production — the schema of
every endpoint is a map of the API for anyone probing it.

## Modules

| Module | Owns |
|---|---|
| `auth` | Register, login, refresh, logout, tenant switching |
| `tenant` | `/me`, tenant settings, member list |
| `asset` | The register: assets, movements, locations, categories, asset codes |
| `audit` | The append-only trail |
| `billing` | Plans, limits, metered usage, subscriptions, invoices |
| `export` | CSV, Excel, PDF report, QR labels, bulk import |
| `apikey` | Customer API credentials |
| `health` | The deploy gate |

## Tenant isolation

The thing that must never fail. Three layers, spec §3.1:

| Layer | Where | Does |
|---|---|---|
| Schema | `migrations/` | `tenantId NOT NULL`; every unique key composite with it |
| Context | `common/context/tenant.context.ts` | Holds the tenant from the **verified token** |
| Query | `common/services/tenant-scope.hook.ts` | Injects `tenantId` into every read and write |

The third layer is what makes the guarantee hold, because it does not depend on
anyone remembering `where: { tenantId }`.

Three details that are easy to get wrong, and were:

- Hooks are registered **per model**, not on the connection. Sequelize's
  connection-level `beforeFind` receives options with no `model` on them, so a
  global hook cannot tell which table it is filtering.
- A query naming a **different** tenant is rejected, not rewritten. Silently
  correcting it would leave the query meaning something other than what it says,
  and a real isolation bug would return plausible data instead of an error.
- The request binds the tenant with `enterWith`, not `run`. A handler executes
  when the framework subscribes to the interceptor's observable, long after a
  `run()` callback has returned — any interceptor that awaits something first
  would otherwise lose the tenant.

`runWithoutTenantScope()` is the only way across, reserved for audited
platform-admin work. Finding every bypass is one grep.

## Auth

- Access token 15 minutes, refresh token 30 days, both httpOnly cookies. Also
  returned in the body, for mobile and API clients.
- Redis is the source of truth for live sessions, so a signed but revoked token
  stops working. Refresh rotates the session id, so a leaked refresh token
  cannot be replayed after the real user has used it.
- Every route requires a token unless marked `@Public()`. New routes are
  protected by default.
- Roles are ranked: `@Roles(ADMIN)` admits `owner` without listing it.
- Login compares against a dummy hash for unknown accounts, so response timing
  cannot be used to enumerate customers.

## Plan limits

Limits are **data**. `plans.limits` is JSONB, and `tenants.settings.limitOverrides`
layers on top — which is how a founding-customer discount exists without an `if`
in the guard. `-1` means unlimited.

Enforcement happens in two places, and only one of them is authoritative:

- `QuotaGuard` rejects a request that is *already* over its limit, before any
  work is done. It is the friendly check.
- `UsageService.increaseWithinLimit` carries the condition **on the increment**,
  inside the transaction. This is what actually holds.

The guard alone is not enough, and this was a real bug: with one slot left,
eight concurrent captures all read the same room before any of them wrote, and
all eight succeeded — the tenant ended up at ten assets on a limit of three.
Postgres settles it now; exactly one increment wins.

Counters are maintained rather than recounted, because counting a million assets
to decide whether a tenant may add one more gets slower exactly as the customer
gets more valuable. `UsageService.reconcile` recounts from the source tables to
correct drift.

## Billing

Everything payment-related sits behind `PaymentProvider`. Nothing outside
`modules/billing/providers/` knows which gateway is in use — Sri Lanka forces
this, since Stripe does not onboard LK-registered businesses directly and a
foreign entity or a second local gateway each mean another class, not a rewrite.

Three rules hold the money side together:

**Only a verified webhook activates a subscription.** `POST /billing/subscribe`
creates a *pending* row and returns checkout fields; the tenant's plan does not
move. A return URL is a navigation, not a payment, and is forged by typing it.

**Callbacks are processed exactly once.** The unique index on
`(provider, eventId)` in `webhook_events` is the guarantee — the insert failing
on a retry *is* the signal to stop. PayHere sends no delivery id, so one is
derived from the fields identifying the payment: a genuine retry produces the
same string, a later renewal does not.

**A rejected signature changes nothing and still answers 200.** A provider that
gets an error retries, and retrying a forged callback forever is only noise.

Dunning is in `AccessService`. A failed renewal keeps **full** access for 14
days — a declined card is usually an expiry, not a decision to leave, and
locking someone out on day one loses a customer over a problem they would have
fixed. After that, read-only. Reads are never blocked and **export is never
blocked, at any subscription state**.

⚠️ The PayHere field names and hash formulas are written from documentation, not
a live integration. See [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md#before-taking-real-money)
before real money moves.

## Exports, labels and import

CSV is written by hand in `service/csv.ts` rather than through a library. Export
is the promise that a customer can always leave, so it should not depend on a
package that might break or be abandoned — and the whole format is escaping and
line endings.

Three things that file gets right and are easy to get wrong:

- A value beginning `=`, `+`, `-` or `@` is prefixed with an apostrophe. Excel
  executes those as formulas, and the value came from whatever someone typed
  into an asset name.
- Fields containing a comma, quote or newline are quoted, inner quotes doubled.
- A UTF-8 BOM, or Excel on Windows reads the file as Latin-1 and Sinhala text
  opens as mojibake — which the customer reads as lost data.

**Import is all-or-nothing.** Every problem is collected with its line number
rather than stopping at the first, and the plan limit is checked against the
whole file before anything is written, so the answer is "this file needs 400
slots and you have 100" rather than a refusal on row 101 with 100 rows already
in. Locations and categories named in the file are created as needed.

**QR labels** encode the asset code, not a URL. A URL ties every printed sticker
to a domain we would then be unable to change.

⚠️ `ExportModule` must stay registered **before** `AssetModule` in
`app.module.ts`. Nest matches routes in registration order, and
`AssetController`'s `@Get(':id')` otherwise swallows `/assets/export`.

## API keys

The key is never stored — only a SHA-256 hash, so a leak of the table hands
nobody a working credential. SHA-256 rather than bcrypt because a key is 32
random bytes we generated, not a human-chosen password: there is nothing to
brute-force, and the check runs on every API request.

A key is capped at `viewer` or `entry`. An unattended credential should not be
able to delete the register or change what the company is billed.

Keys are revoked, never deleted: the audit trail refers to them, and "when did
this stop working" is worth being able to answer.

## Asset codes

`TS-0001`, `TS-0002`, … Unique per tenant, gapless, never reused.

One statement issues them — `INSERT … ON CONFLICT DO UPDATE … RETURNING` inside
the same transaction as the asset insert, so Postgres serialises concurrent
captures itself. A read-then-write has a window where two captures read the same
number.

A capture that fails rolls the increment back and leaves no hole. A deleted asset
never releases its code, because that code is already on a label.

## Migrations

`synchronize` is **off**. It drops columns it does not recognise — fine in a
scratch project, unacceptable with customer data.

```bash
npm run migration:create -- add-something
npm run migrate
npm run migrate:status
npm run migrate:undo
```

They run as Railway's pre-deploy command, so a migration that fails stops the
deploy and the previous version keeps serving.

A migration that adds a counter or a constraint must **backfill** — see
`20260925020000-phase4-usage-counters.js`. Without it, every existing tenant
starts at zero usage and can exceed its plan by exactly what it already holds.

## Health

| Route | Checks | For |
|---|---|---|
| `/api/v1/health` | Postgres + Redis | Railway's deploy gate. 503 if either is down. |
| `/api/v1/health/live` | nothing | Liveness. 200 while the process is alive. |

Separate on purpose: a restart should be triggered by the process being wedged,
not by Postgres having a bad minute. Both are `@Public()` — a health check that
needs a token fails every deploy.

## Tests

See [`docs/TESTING.md`](../../docs/TESTING.md).

```bash
npm run test:isolation
```
