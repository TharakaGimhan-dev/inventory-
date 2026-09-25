# Inventory SaaS — Architecture Spec

Multi-tenant office asset & inventory register, sold as a subscription.
Successor to the single-org **TS Asset Register** (Next.js + Firebase, Phase 1 complete)
and built on the layered NestJS architecture of the **TaskFlow Mini API** reference project.

This document is the single source of truth. Read it before changing anything.

Status: **draft for review** — no application code written yet.

---

## 1. Product

| | |
|---|---|
| What | Office asset inventory: capture an asset, tag it with a code, track location/owner/value, search the register, export it. |
| Who | Sri Lankan SMEs and offices. Two paying-intent customers already waiting. |
| Shape | Mobile-first PWA for capture; desktop register and reports for admins. |
| Sold as | Free tier to land the customer, paid plans for scale and the features that cost us money. |

### 1.1 Why not stay on Firebase

The Phase-1 app puts authorization in `firestore.rules`. That works for one organisation.
It does not work for a subscription business, because rules cannot:

- count rows to enforce a plan limit ("Free = 100 assets") without a maintained counter per tenant, which is racy and forgeable;
- read subscription state from a payment provider webhook and act on it atomically;
- meter usage for billing;
- run a scheduled job (trial expiry, dunning, retention deletes);
- keep an audit trail the tenant's own admin cannot rewrite.

Every one of those is server-side work. So the backend becomes a real API.
Firestore's genuinely good part — offline capture on a phone — is replaced by
IndexedDB + an outbox queue in the PWA (§8.3), which we control.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| API | **NestJS 11** (TypeScript) | Same structure as the reference project: `models/` → `schemas/` → `service/` → `controller/`, guards, pipes, DI. |
| ORM | **Sequelize 6 + sequelize-typescript** | Carried over from the reference project. |
| DB | **PostgreSQL** (Railway) | Already provisioned in the Railway project. Sequelize dialect `postgres`; no other code change vs. the reference project's `mysql`. |
| Cache/queue | **Redis** (Railway) | Refresh tokens, rate limits, BullMQ jobs. |
| Web | **Next.js 15** (App Router) PWA | Ports the existing `app/(auth)` + `app/(app)` shell. |
| Images | **ImageKit.io** | Already chosen; private key stays server-side, uploads are signed by the API. |
| Validation | **Zod** | Shared schemas, one source of truth for form and write path. |
| Docs | **Swagger** at `/docs` | As in the reference project. |
| Host | **Railway** | API service, Web service, Postgres, Redis — private networking between them. |

### 2.1 Services on Railway

```
┌────────────┐      ┌────────────┐
│  web       │─────▶│  api       │
│  Next.js   │ HTTPS│  NestJS    │
└────────────┘      └─────┬──────┘
                          │ private network
                    ┌─────┴─────┬──────────┐
                    ▼           ▼          ▼
               ┌────────┐  ┌───────┐  ┌─────────┐
               │postgres│  │ redis │  │ imagekit│
               └────────┘  └───────┘  └─────────┘
```

`web` talks to `api` over the public URL (the browser must reach it).
`api` talks to Postgres and Redis over Railway's private network — never public.

---

## 3. Tenancy

**Shared database, `tenantId` on every tenant-owned row.**

Chosen over database-per-tenant: at 2–200 customers, per-tenant databases mean every
migration runs N times and onboarding needs provisioning. Shared-DB is the standard
early-SaaS choice and is reversible later (a tenant can be extracted by filtering on
`tenantId`).

### 3.1 The isolation guarantee

Isolation must not depend on a developer remembering a `where` clause. Three layers:

1. **Schema** — every tenant-owned table has `tenantId UUID NOT NULL`, indexed, and every
   unique constraint is composite with it (`UNIQUE (tenantId, code)`, never `UNIQUE (code)`).
2. **Request context** — `TenantContextMiddleware` resolves the tenant from the JWT and
   stores it in an `AsyncLocalStorage`. Controllers never read `tenantId` from the request
   body or a query param; a client-supplied `tenantId` is ignored, always.
3. **Query layer** — Sequelize hooks (`beforeFind`, `beforeCount`, `beforeBulkUpdate`,
   `beforeBulkDestroy`, `beforeValidate`) inject `tenantId` from the context into every
   query on a tenant-owned model, and throw if the context is empty. A query cannot be
   written that crosses tenants.

   The hooks are registered **per model**, not on the connection: Sequelize's
   connection-level `beforeFind` receives an options object with no `model` on it, so a
   global hook cannot tell which table it is filtering.

   A query or write that explicitly names a *different* tenant is **rejected**, not
   rewritten. Silently correcting it would leave the query meaning something other than
   what it says, and a real isolation bug would then return plausible data instead of
   an error somebody notices.

Only the platform-admin module (§5.2) may bypass layer 3, through an explicit
`runWithoutTenantScope()` call that logs every use.

### 3.2 Test obligation

The equivalent of the old `tests/rules/` suite. A tenant-isolation suite that must pass in CI:

| # | Case | Expected |
|---|---|---|
| 1 | Tenant A's token reads tenant B's asset by id | 404 (not 403 — no existence leak) |
| 2 | Tenant A creates an asset with `tenantId: B` in the body | Rejected, nothing written. A create with no `tenantId` is stamped with A |
| 3 | Two tenants both create asset code `TS-0001` | Both succeed |
| 4 | Any query issued with an empty tenant context | Throws, does not return all rows |
| 5 | Unauthenticated request to any tenant route | 401 |
| 6 | `viewer` role attempts a create | 403 |
| 7 | Nobody, any role, can edit `code` | 400 |
| 8 | Nobody can delete an audit entry | 403 |
| 9 | A query whose `where` names tenant B, run as A | Rejected, not silently rewritten to A |
| 10 | Two tenants query concurrently | Neither sees the other's rows |

Cases 5–8 are carried over from the Firebase spec §11.1 — the rules they tested still hold,
they are just enforced in a different place now.

---

## 4. Data model

All ids are UUIDv4. All tenant-owned tables carry `tenantId`, `createdAt`, `updatedAt`.

### 4.1 Platform tables (no tenantId)

**`tenants`** — the customer organisation.
`id`, `name`, `slug` (unique, their subdomain//login hint), `status`
(`trialing` | `active` | `past_due` | `suspended` | `cancelled`), `planId`, `trialEndsAt`,
`billingEmail`, `country`, `currency` (default `LKR`), `settings` (JSONB), `deletedAt`.

**`plans`** — the price list, seeded, editable without a deploy.
`id`, `code` (`free` | `starter` | `business`), `name`, `priceMonthly`, `priceYearly`,
`currency`, `limits` (JSONB, §6.2), `features` (JSONB), `isPublic`, `sortOrder`.

**`subscriptions`** — one active row per tenant.
`id`, `tenantId`, `planId`, `status`, `currentPeriodStart`, `currentPeriodEnd`,
`cancelAtPeriodEnd`, `provider`, `providerRef`, `amount`, `currency`.

**`invoices`** — `id`, `tenantId`, `subscriptionId`, `number`, `status`
(`draft`|`open`|`paid`|`void`|`uncollectible`), `amount`, `currency`, `issuedAt`, `paidAt`, `providerRef`.

**`users`** — a person. Global, because one person may belong to two tenants.
`id`, `email` (unique), `passwordHash`, `firstName`, `lastName`, `isActive`, `lastLoginAt`.
Carried directly from the reference project's `user.model.ts`, minus `role` — role is
per-membership, not per-user.

**`memberships`** — user ↔ tenant, `UNIQUE (tenantId, userId)`.
`id`, `tenantId`, `userId`, `role`, `status` (`invited`|`active`|`disabled`), `invitedBy`, `joinedAt`.
This is the successor to `orgs/{orgId}/members/{uid}`.

### 4.2 Tenant tables

**`locations`** — `tenantId`, `name`, `parentId` (self-FK, so Floor → Room), `code`, `isActive`.

**`categories`** — `tenantId`, `name`, `parentId`, `defaultUsefulLifeMonths`.

**`assets`** — the core record.
`tenantId`, `code` (`UNIQUE (tenantId, code)`, immutable — §5.4), `kind`
(`asset` | `consumable`), `name`, `description`, `categoryId`, `locationId`,
`assignedToUserId`, `serialNumber`, `status` (`in_use`|`in_store`|`repair`|`written_off`|`disposed`),
`condition`, `purchaseDate`, `purchasePrice`, `replacementValue`, `supplier`, `warrantyEndsAt`,
`quantity` (consumables only), `imageIds` (JSONB, ImageKit file ids), `customFields` (JSONB),
`deletedAt` (soft delete — assets are never hard-deleted).

**`asset_movements`** — location/custody history.
`tenantId`, `assetId`, `fromLocationId`, `toLocationId`, `fromUserId`, `toUserId`, `movedAt`,
`movedBy`, `note`.

**`counters`** — `UNIQUE (tenantId, key)`, `value`. Successor to `counters/assetCode`.
Incremented inside the same transaction as the asset insert, by a single
`INSERT … ON CONFLICT DO UPDATE … RETURNING` — Postgres takes the row lock itself, so
two concurrent captures are serialised by the database. A read-then-write shape
(`findOrCreate`, or `SELECT` then `UPDATE`) leaves a window where both transactions see
the same number.

**`audit_entries`** — append-only.
`tenantId`, `actorUserId`, `entity`, `entityId`, `action`, `before` (JSONB), `after` (JSONB),
`ip`, `userAgent`, `createdAt`. No update route, no delete route, at any role.

**`usage_counters`** — `UNIQUE (tenantId, metric, period)`, `value`.
Metrics: `assets`, `members`, `storage_bytes`, `exports`. Read by the quota guard (§6.3).

---

## 5. Auth and roles

### 5.1 Tenant roles

Replaces the reference project's two-value `UserRole` enum.

| Role | Can |
|---|---|
| `owner` | Everything, plus billing, plan changes, and deleting the tenant. Exactly one per tenant. |
| `admin` | Everything except billing and tenant deletion. Invites users, edits settings, exports. |
| `entry` | Create and edit assets. Cannot change `replacementValue`, cannot delete, cannot export. |
| `viewer` | Read only. |

Enforced by an extended `RolesGuard` reading `@Roles()` metadata — same mechanism as the
reference project, reading role from the **membership**, not the user.

### 5.2 Platform roles

Separate axis, on the `users` table (`platformRole`: `none` | `support` | `superadmin`).
Used by the internal admin module to list tenants, read subscription state, and impersonate
for support. Every impersonation writes an audit entry naming the operator, and the
impersonated session is capped at 30 minutes and is read-only unless the tenant owner
granted write support.

### 5.3 Tokens

Carried from the reference project: JWT access token + refresh token stored in Redis.

- Access token: 15 min. Claims `sub`, `email`, `tid` (active tenant), `role`, `plan`.
- Refresh token: 30 days, one Redis key per session, revoked on logout and on password change.
- A user in two tenants holds one refresh token and swaps `tid` through `POST /auth/switch-tenant`,
  which re-issues the access token after re-checking membership.
- Web stores tokens in httpOnly, Secure, SameSite=Lax cookies — not localStorage.

### 5.4 Signup

Unlike the Firebase app, **self-signup is open** — that is the free tier's acquisition path.
`POST /auth/register` creates user + tenant + `owner` membership + a `free` subscription in one
transaction, and sends a verification email. Invited users join an existing tenant by token and
never create one.

Asset codes are never reused. Counters never rewind. Carried from the Firebase spec §5.4 —
a reissued code would collide with a label already stuck on equipment.

---

## 6. Plans, limits and billing

### 6.1 Tiers

Indicative, in LKR, to be confirmed against what your two customers will pay.

| | **Free** | **Starter** | **Business** |
|---|---|---|---|
| Price / month | 0 | ~2,500 | ~7,500 |
| Assets | 100 | 1,000 | unlimited |
| Users | 2 | 10 | unlimited |
| Locations | 5 | unlimited | unlimited |
| Photos per asset | 1 | 5 | 10 |
| Storage | 200 MB | 5 GB | 25 GB |
| CSV export | ✓ | ✓ | ✓ |
| PDF/Excel reports | — | ✓ | ✓ |
| QR/barcode label sheets | — | ✓ | ✓ |
| Audit trail retention | 30 days | 1 year | unlimited |
| Custom fields | — | 5 | unlimited |
| API access | — | — | ✓ |
| Support | community | email | priority |

The two waiting customers start on **Free**, are migrated to **Starter** when the paid
features land, and get a founding-customer discount recorded on their subscription row
rather than as a special code path.

### 6.2 Limits live in the database

`plans.limits` is JSONB: `{ "assets": 100, "members": 2, "storageBytes": 209715200, … }`.
`-1` means unlimited. Changing a limit is a row update, not a deploy. A tenant may carry a
per-tenant override in `tenants.settings.limitOverrides` for the founding-customer case.

### 6.2b Features

`plans.features` is JSONB alongside the limits, and `@RequiresFeature('reports')` gates a
route on it. A capability moves between tiers by editing a row.

`csvExport` is **always true**, whatever the plan says. The promise that a customer can
take their data out is not a paid feature — it is why they can trust us with it.

A gated route answers `402` with the feature name, so the app shows an upgrade prompt
rather than an error.

### 6.3 Enforcement

Two places, and only one of them is authoritative.

`QuotaGuard` + `@Quota('assets')` runs after `RolesGuard` and before the controller. It
reads `usage_counters`, compares against the effective limit, and throws `402 Payment
Required` naming the metric, the limit and the upgrade URL — so the UI shows a real
upgrade prompt rather than a generic error. This is the friendly check: it refuses the
obvious case before any work is done.

**A guard cannot hold a limit under concurrency**, and this was a real bug. It reads the
counter and then acts; every request that read before any of them wrote sees the same
room. With one slot left, eight simultaneous captures all passed and the tenant reached
ten assets on a limit of three.

So enforcement lives on the increment: `UsageService.increaseWithinLimit` runs
`INSERT … ON CONFLICT DO UPDATE … WHERE value + delta <= limit RETURNING value`, inside
the write's transaction. Postgres evaluates the condition with the row locked, so exactly
one of those eight wins and the rest get no row back and a `402`. The slot is claimed
before the asset code is issued, so a refused capture consumes no code.

Usage counters are updated in the same transaction as the write that changes them, and
reconciled by a job that recounts from the source tables — a counter is an optimisation,
and optimisations drift.

### 6.4 Downgrade and non-payment

Over-limit tenants are **never** silently deleted.

| State | Effect |
|---|---|
| Trial ended, no card | Read-only after 7 days. Data kept. |
| `past_due` | Full access for 14 days, banner + emails on days 1, 3, 7, 13. |
| After 14 days | Read-only. Export stays enabled — they can always get their data out. |
| `cancelled` | Read-only 30 days, then data export emailed, then scheduled delete at 90 days. |
| Downgrade over limit | Existing rows stay readable and editable; new creates blocked until under limit. |

### 6.5 Payments

Sri Lanka constrains this. Stripe does not onboard LK-registered businesses directly.

| Option | Note |
|---|---|
| **PayHere** | LK-local, recurring supported, LKR. The realistic default. |
| **Onepay / WebXPay** | LK alternatives, similar shape. |
| **Stripe** | Only viable via a foreign entity. Keep as the path for non-LK customers. |
| **Manual/bank transfer** | Needed anyway — SME customers will ask for it. An `owner` requests an invoice, an operator marks it paid in the platform admin. |

The API isolates this behind a `PaymentProvider` interface (`createCheckout`,
`parseWebhook`, `cancel`) so a second provider is a new class, not a rewrite.

**Only a verified webhook may activate a subscription.** A return URL is a navigation,
not a payment, and is trivially forged by typing it — so the plan changes when the
provider says money moved, never when the browser comes back.

Callbacks are processed **exactly once**, enforced by a unique index on
`(provider, eventId)` in `webhook_events`. Providers retry; a retry applied twice extends
a subscription twice or writes a second invoice for one payment.

⚠️ **The PayHere field names and hash formulas in `payhere.provider.ts` are written from
documentation, not from a live integration.** They must be verified against PayHere's
current docs and their sandbox before real money moves — a mismatch fails in the worst
way, where a customer is charged and the callback is rejected, so they pay and stay
locked out. The signature check is also the security boundary: wrong in the lenient
direction, anyone who can POST to the notify URL marks any subscription paid.

---

## 7. API surface

`/api/v1`, Swagger at `/docs`. All tenant routes require a bearer token.

```
POST   /auth/register                 create user + tenant + free subscription
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
POST   /auth/switch-tenant
POST   /auth/forgot-password  /auth/reset-password  /auth/verify-email

GET    /me                            user + memberships + active tenant + plan + usage

GET    /tenant                        settings
PATCH  /tenant                        owner|admin
GET    /tenant/members
POST   /tenant/members/invite         owner|admin, quota: members
PATCH  /tenant/members/:id            role / disable
DELETE /tenant/members/:id

GET    /assets                        filter, search, cursor pagination
POST   /assets                        owner|admin|entry, quota: assets
GET    /assets/:id
PATCH  /assets/:id                    entry cannot touch replacementValue
DELETE /assets/:id                    owner|admin, soft delete
POST   /assets/:id/move               custody/location change
GET    /assets/:id/history
POST   /assets/bulk-import            owner|admin, CSV
GET    /assets/export                 CSV — every plan, every subscription state
GET    /assets/export.xlsx            feature: reports
GET    /assets/report.pdf             feature: reports
POST   /assets/labels.pdf             feature: labels, QR sheet
POST   /assets/import                 owner|admin, CSV, all-or-nothing

GET    /tenant/custom-fields
PUT    /tenant/custom-fields          owner|admin, limited by plan

GET    /api-keys                      owner|admin, feature: api
POST   /api-keys                      secret shown once, never stored
DELETE /api-keys/:id                  revoked, not deleted

GET/POST/PATCH/DELETE  /locations  /categories

POST   /uploads/sign                  ImageKit signature, quota: storage_bytes

GET    /dashboard                     counts by status/location/category, value totals
GET    /audit                         owner|admin, paginated, read-only

GET    /billing/plans                 public
GET    /billing/subscription
POST   /billing/subscribe             owner
POST   /billing/cancel                owner
GET    /billing/invoices
POST   /webhooks/payhere              public, signature-verified

GET    /health                        deployment smoke check
GET    /admin/tenants                 platformRole: support|superadmin
POST   /admin/impersonate/:tenantId   superadmin, audited
```

---

## 8. Web app

### 8.0 One origin, not two

The browser calls `/api/v1/…` on the web app's own host and Next rewrites it to the API
service. The API's tokens are httpOnly cookies, and on Railway the two services have
different hostnames, so every direct call would be cross-site — where a `SameSite=Lax`
cookie is not sent. The alternatives are worse: `SameSite=None` widens CSRF exposure, and
moving tokens to `localStorage` puts them where injected script can read them.

`API_URL` is therefore server-side only and must never gain a `NEXT_PUBLIC_` prefix.

### 8.1 What carries over from Phase 1

The existing Next.js shell ports nearly whole: `app/(auth)/login`, the auth-guarded
`app/(app)/` layout, header, bottom tabs, mobile-only layout centred at 640 px,
`public/sw.js`, the icon generator. What changes is underneath: `lib/firebase.ts` becomes
`lib/api.ts` (a typed fetch client with cookie auth and refresh-on-401), and
`lib/hooks/useAuth.tsx` reads `/me` instead of a Firestore member doc.

The "Your account is not linked to an organisation" screen survives as the no-membership case.

### 8.2 New surfaces

Marketing site (`inventory.lk`-style landing, pricing, signup), onboarding wizard,
desktop register with a data table, dashboard, settings + members, and billing.

### 8.3 Offline capture

Firestore's IndexedDB persistence is replaced by an explicit outbox:
a capture writes to IndexedDB and enqueues a mutation; a flush on reconnect sends the queue
to the API with a client-generated idempotency key, so a double-flush cannot create two assets.
The API stores the response against that key in Redis for 24 hours and returns it on a repeat,
which is what makes the replay safe — without it a retry would create a second asset that has
permanently consumed a second code.
Asset codes are **assigned by the server**, so an offline capture shows "code pending" until
it syncs — codes must stay gapless and unreusable (§5.4), which a client cannot guarantee.

---

## 9. Environments and secrets

```
NODE_ENV  PORT  API_URL  WEB_URL
DATABASE_URL                       Railway Postgres, private network
REDIS_URL                          Railway Redis, private network
JWT_ACCESS_SECRET  JWT_REFRESH_SECRET
JWT_ACCESS_EXPIRES_IN=15m          JWT_REFRESH_EXPIRES_IN=30d
IMAGEKIT_PUBLIC_KEY  IMAGEKIT_PRIVATE_KEY  IMAGEKIT_URL_ENDPOINT
PAYHERE_MERCHANT_ID  PAYHERE_SECRET
SMTP_URL  MAIL_FROM
```

`IMAGEKIT_PRIVATE_KEY`, `PAYHERE_SECRET` and both JWT secrets are API-only and must never
gain a `NEXT_PUBLIC_` prefix — carried from the Firebase README's warning.
Every `NEXT_PUBLIC_*` the web needs must be set in the Railway web service too,
or the client throws on boot naming the missing variable.

**`synchronize: true` from the reference project is not used.** It is fine for a teaching
project and unacceptable with customer data — it silently drops columns. Sequelize migrations
run on deploy via a Railway release command.

---

## 10. Phases

| Phase | Delivers | Done when |
|---|---|---|
| **0 — Foundation** | Nest skeleton, Postgres + Redis wired, migrations, health check, Swagger, CI, Railway deploy. | `/api/v1/health` green on Railway. **Done.** |
| **1 — Tenancy & auth** | tenants, users, memberships, JWT + refresh, roles guard, tenant scope hook. | The §3.2 isolation suite passes. **Done.** |
| **2 — Core register** | locations, categories, assets, code counter, movements, audit entries. | Two tenants each hold `TS-0001` and cannot see each other's. **Done.** |
| **3 — Web port** | Existing shell on the new API, capture form, register list, offline outbox. | A phone captures an asset offline and it syncs. **Done.** |
| **4 — Plans & quotas** | plans, usage counters, QuotaGuard, upgrade prompts. | Free tenant is blocked at asset 101 with a 402 naming the limit. **Done.** |
| **5 — Billing** | PayHere, webhooks, invoices, dunning. | A real card moves a tenant Free → Starter. **Built; needs sandbox verification against a live merchant account.** |
| **6 — Paid features** | Reports, label sheets, custom fields, bulk import, API keys. | Starter/Business differ in the product, not just the price page. **Done.** |
| **7 — Launch** | Marketing site, pricing page, onboarding, docs, support inbox. | The two customers are on Starter. |

Phases 0–3 get your two customers a working product on the free tier. Phases 4–5 are what
make it a business. Nothing in 0–3 should be built in a way that has to be undone in 4–5 —
that is what `tenantId`, `plans.limits` and the counters are for, even while every tenant is free.

---

## 11. Decisions already made

- Shared database with `tenantId`, not database-per-tenant. §3
- Server-enforced limits from a `plans` row, not constants in code. §6.2
- Export is never disabled, at any subscription state. §6.4
- Asset codes are server-assigned, immutable, gapless, never reused. §5.4
- Audit entries are append-only with no delete route at any role. §4.2
- Payments behind a provider interface; PayHere first. §6.5
- No `synchronize: true`; migrations only. §9

## 12. Open questions

1. Confirm the LKR price points against what your two customers will actually pay.
2. PayHere merchant account — do you have one, or does it need registering?
3. Do the two customers need data migrated out of the existing Firebase project, or are they starting fresh?
4. Custom domain for the app, and is per-tenant subdomain (`acme.yourdomain.lk`) wanted at launch or later?
5. Sinhala/Tamil UI at launch, or English only first?
