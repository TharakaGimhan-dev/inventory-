# Deploying to Railway

Four services in one project.

```
web (Next.js)  ──▶  api (NestJS)  ──▶  postgres
                          │
                          └────────▶  redis
```

`web` and `api` need public domains. **`postgres` and `redis` must not have
one** — they are reached over Railway's private network. Generating a domain for
a database is the difference between a private database and one anyone can find.

## 1. Postgres and Redis

Add both from Railway's service catalogue. Nothing to configure; note that
Railway exposes each as `${{ServiceName.VARIABLE}}` to the other services.

## 2. The API service

| Setting | Value |
|---|---|
| Root Directory | `apps/api` |
| Build / Start / Pre-deploy | supplied by `apps/api/railway.json` |
| Healthcheck Path | `/api/v1/health` (also in `railway.json`) |

Variables:

```
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
JWT_ACCESS_SECRET=<openssl rand -base64 48>
JWT_REFRESH_SECRET=<a different one>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
CORS_ORIGINS=https://<your web domain>

WEB_URL=https://<your web domain>
API_URL=https://<your api domain>

PAYHERE_MERCHANT_ID=<from the PayHere merchant portal>
PAYHERE_SECRET=<from the PayHere merchant portal>
PAYHERE_SANDBOX=false
```

`WEB_URL` and `API_URL` build the return, cancel and notify URLs PayHere needs.
Getting `API_URL` wrong means payments succeed and the callback never arrives —
customers pay and stay locked out.

Leave the PayHere variables empty and the app runs with online payment off:
`/billing/subscribe` answers "not configured yet" instead of half-working.

**Reference the services, do not paste the values.** `${{Postgres.DATABASE_URL}}`
keeps working when a password rotates; a pasted string breaks the deploy on a day
nobody changed anything.

Then Settings → Networking → Generate Domain.

### After the first deploy

Migrations run automatically as the pre-deploy command. Seed the plan catalogue
once, from the service shell:

```bash
npm run seed
```

Without it, tenants fall back to free-tier limits — deliberately, since failing
closed costs a customer an upgrade prompt while failing open costs the business
model.

## 3. The web service

| Setting | Value |
|---|---|
| Root Directory | `apps/web` |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm run start` |

Variables:

```
API_URL=https://<your api domain>
```

`API_URL` is **server-side only**. It must not get a `NEXT_PUBLIC_` prefix — the
browser never calls the API directly, it calls this app's own origin and Next
proxies it. See [`apps/web/README.md`](../apps/web/README.md).

Then Settings → Networking → Generate Domain, and put that domain into the API's
`CORS_ORIGINS`.

## 4. PayHere

### Before taking real money

The field names and the two hash formulas in
`apps/api/src/modules/billing/providers/payhere.provider.ts` are written from
PayHere's documentation, **not from a live integration against your merchant
account**. Gateways change field names and add required parameters.

A mismatch fails in the worst possible way: the customer is charged, the callback
is rejected, and they have paid and stayed locked out.

Against PayHere's current docs and their sandbox:

1. Confirm every field name in `createCheckout`.
2. Confirm the `md5sig` formula in `parseWebhook` — including the case of each
   hash and the exact amount formatting PayHere signs.
3. Confirm the `recurrence` and `duration` values for a monthly subscription.
4. Run a sandbox payment end to end and read the real notification body.

The signature check is the security boundary. Wrong in the lenient direction,
anyone who can POST to the notify URL marks any subscription paid.

### Setting it up

1. In the PayHere merchant portal, add your API domain as an allowed domain.
2. Set the notify URL to `https://<api domain>/api/v1/webhooks/payhere`.
3. Put the merchant id and secret into the API service's variables.
4. Keep `PAYHERE_SANDBOX=true` until a sandbox payment has completed end to end.

### Cancelling a subscription

PayHere cancels a recurring subscription from the merchant portal or through its
Subscription API, which needs a separate OAuth app. Until that is set up,
`POST /billing/cancel` marks our side cancelled and logs a warning — the final
charge has to be stopped by hand in the portal. That is deliberate: a silent
no-op would let a cancelled customer be billed again.

## 5. Check it

```bash
curl https://<api domain>/api/v1/health
```

`200` with `database` and `redis` both `up` means the deploy is live.

## Things that will bite

**Binding the wrong interface.** The app binds `0.0.0.0` and reads Railway's
`PORT`. The Node default binds inside the container only, and the health check
then fails every deploy with no obvious cause.

**A `NEXT_PUBLIC_` prefix on a secret.** That prefix ships the value to the
browser. `IMAGEKIT_PRIVATE_KEY`, `PAYHERE_SECRET` and both JWT secrets are
API-only.

**A missing `NEXT_PUBLIC_*` the web app does need.** The client throws on boot
naming the variable.

**Skipping the seed.** Everything works, and every tenant silently sits on
free-tier limits.

**A public domain on the database.** Nothing appears to break, which is the
problem.

## The daily job

A scheduled task runs at 03:00 to close lapsed subscription periods and recount
every tenant's usage. It runs inside the API process, so it needs **exactly one**
instance to be the one that runs it. If you scale the API to more than one
replica, move this to a separate worker service or a Railway cron — otherwise
every replica reconciles every tenant, every night.

## Rollback

Railway keeps previous deploys; redeploy one from the service's Deployments tab.

Migrations are **not** rolled back automatically. Write migrations so an older
version of the app still runs against the newer schema — add columns, do not
rename or drop them in the same release as the code that stops using them.
