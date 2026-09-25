# Changelog

Phases are defined in [`SAAS_SPEC.md`](SAAS_SPEC.md) §10.

## Security review — OWASP Top 10:2025

An audit against the 2025 list, with fixes. The finding that mattered: **forty
wrong passwords in ten seconds were all answered, none were recorded, and
nothing slowed down.** No rate limit, no lockout, no log.

Fixed:

- Rate limiting (10 logins/min, 5 signups/hour, 300 req/min otherwise) **and**
  a per-account lockout after 8 failures. Two layers, because a rate limit keyed
  on the caller's address gives an attacker with many addresses many budgets
  against one account.
- Counters stored in **Redis**, not in the process — in-memory counts give each
  replica its own budget, so scaling to three would have tripled every limit.
  Written against the existing ioredis client rather than adding a dependency.
- `users.tokensValidFrom` had existed since Phase 1 and **nothing read it**,
  which made "changing your password ends a stolen session" a promise the code
  did not keep. Now enforced, with a `POST /auth/change-password` that sets it
  and deletes every refresh session.
- Failed logins and lockouts are logged with the account and address.
- JWT verification pins **HS256**. Unpinned, a verifier accepts whatever
  algorithm the token's own header names.
- `trust proxy = 1`. Without it every request appeared to come from Railway's
  proxy: one shared rate-limit bucket for the whole internet, and the proxy's
  address on every audit entry.
- Explicit body limits. Express defaults to 100 KB, which silently answered 413
  to an import the route's own schema said could be 5 MB.
- Full security header set on the web app, including a CSP whose
  `connect-src 'self'` means an injected script has nowhere to send what it
  reads. `poweredByHeader` off.
- `uuid` pinned past GHSA-w5hq-g745-h8pq via an override: **0 vulnerabilities**
  in both apps.
- CI audits production dependencies as a gate; Dependabot watches between pushes.

[`docs/SECURITY.md`](docs/SECURITY.md) records the eight gaps that remain —
email verification, password reset and alerting being the three to close before
launch.

## Phase 6 — Paid features

What makes Starter and Business differ in the product rather than only on the
price page. Features are data on the plan row, gated by `@RequiresFeature`,
which answers `402` with the feature name so the app prompts an upgrade.

- **Export**: CSV on every plan and in every subscription state, written by
  hand rather than through a library — it is the promise a customer can always
  leave, so it should not depend on a package. Excel and a one-page PDF summary
  are paid.
- **QR label sheets** (paid): 24 to an A4 page on common Avery stock. The QR
  encodes the asset code, not a URL — a URL ties every printed label to a domain
  we could then never change.
- **Bulk import** (admin): all-or-nothing, with every problem reported at once
  with line numbers, and the plan limit checked against the whole file up front.
  Locations and categories named in the file are created as needed.
- **Custom fields**: defined in `tenants.settings`, so adding one is a settings
  change rather than a migration. Limited by plan.
- **API keys** (Business): SHA-256 hashed, shown once, never stored. Capped at
  viewer or entry — an unattended credential should not be able to delete the
  register or change billing. Revoked, not deleted.

CSV writing neutralises formula injection: a value beginning `=`, `+`, `-` or
`@` is prefixed, because otherwise Excel executes whatever someone typed into an
asset name. Fields are quoted and inner quotes doubled, and the file carries a
UTF-8 BOM so Sinhala text does not open as mojibake.

Three bugs found by running it rather than compiling it:

- `GET /assets/:id` swallowed `/assets/export` and answered "uuid is expected".
  Nest matches in module-registration order, so ExportModule now precedes
  AssetModule, with a comment saying it must stay there.
- An API key's `lastUsedAt` never recorded. The write ran after the
  tenant-scope bypass closed, so the hook threw and a bare `.catch()` hid it —
  and last-use is exactly what a customer checks before revoking a key.
- The toast overlaid the page and intercepted clicks, blocking the Import
  button underneath it.

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
