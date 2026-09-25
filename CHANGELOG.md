# Changelog

Phases are defined in [`SAAS_SPEC.md`](SAAS_SPEC.md) §10.

## Phase 5 — Billing

Subscriptions, invoices, dunning and read-only enforcement, behind a
`PaymentProvider` interface with PayHere as the first implementation.

- `POST /billing/subscribe` (owner) returns the fields the browser posts to the
  provider; `POST /billing/cancel` ends at the close of the paid period, not
  immediately — they have paid through it
- `POST /webhooks/payhere` verifies the signature in constant time and is the
  **only** thing that activates a subscription. A return URL is a navigation,
  not a payment.
- Exactly-once processing, enforced by a unique index on `(provider, eventId)`.
  A replayed callback writes one invoice, not two.
- Invoice numbers are global, sequential and never reused; an invoice raised in
  error is voided, not deleted
- `AccessService` narrows an unpaid tenant to read-only after a 14-day dunning
  window — and **never** blocks a read or an export, at any subscription state
- A daily job closes lapsed periods and reconciles every tenant's usage counters
- Plan screen with checkout, invoice history and cancel; the capture form
  explains a read-only lapse rather than showing a bare 403

The PayHere field names and hash formulas are written from documentation, not
from a live integration, and are marked for verification against the sandbox
before real money moves.

Also fixed flakiness in the test setup itself: the suites each rebuild the schema
with `sync({ force: true })` and were racing each other under jest's parallel
workers. `test:isolation` now runs them serially.

## Phase 4 — Plans and quotas

Plan limits enforced end to end. Limits stay data: `plans.limits` is JSONB and
`tenants.settings.limitOverrides` layers on top, so changing a tier or giving a
founding customer more room is a row update, not a deploy.

- `usage_counters`, incremented inside the same transaction as the write, with a
  migration that backfills every existing tenant
- `QuotaGuard` + `@Quota()` reject an already-full plan early with a `402`
  naming the metric, the limit and where to upgrade
- `UsageService.increaseWithinLimit` carries the limit **on the increment**,
  which is what actually holds under concurrency
- `GET /billing/plans` (public) and `GET /billing/subscription`
- A plan screen with usage bars, and a capture form that turns a `402` into an
  upgrade prompt rather than a red error
- Deleting an asset frees its slot; its code stays taken

Fixed a real over-limit hole. `QuotaGuard` read the counter and then acted, so
with one slot left eight concurrent captures all saw the same room and all
succeeded — the tenant reached ten assets on a limit of three. Enforcement moved
onto the increment, where Postgres evaluates the condition with the row locked.
Exactly one of eight now wins, and a refused capture consumes no asset code.

## Phase 3 — Web app

Next.js PWA carrying over the mobile shell of the Firebase app, now against the
API. Login, register with search, capture with conditional fields and sticky
values, locations, tenant switching.

- The browser calls `/api/v1` on the web app's own origin and Next proxies it,
  so the API's httpOnly cookies stay same-site on Railway's separate hostnames.
  No token is ever held in JavaScript.
- Offline capture into IndexedDB with an idempotency key per capture, and an
  interceptor that stores the API's response against that key in Redis for 24
  hours — without which a retry after a lost signal creates a second asset that
  has permanently consumed a second code.

Fixed a context bug this phase exposed: the tenant interceptor used
`AsyncLocalStorage.run()` around `next.handle()`, but the handler runs when the
framework subscribes to that observable, after `run()` has returned. Any
interceptor that awaited something first lost the tenant. Now `enterWith`.

Next upgraded to 16.x; the pinned 15.1.6 carries a published advisory.

## Phase 2 — The asset register

Locations, categories, assets, movements and an append-only audit trail.

- Asset codes unique per tenant, gapless and never reused, issued by a single
  `INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the capture's transaction
- `entry` cannot set `replacementValue`; nobody can change a code; audit entries
  have no write route and the model refuses `update` and `destroy`
- Every write is one transaction covering the row, its counter, its movement and
  its audit entry

## Phase 1 — Tenancy and auth

Tenants, users, memberships, JWT with Redis-backed refresh sessions, a ranked
roles guard, and the three-layer tenant isolation the whole product rests on.

Fixed by running it rather than compiling it: `@UsePipes` at method level applied
the Zod schema to every parameter including `@CurrentUser()`, and the global auth
guard made `/health` require a token — which would have failed every deploy.

## Phase 0 — Foundation

NestJS on Postgres and Redis, env validated at boot, migrations, a health check
split into a dependency gate and a liveness probe, and Railway config.
