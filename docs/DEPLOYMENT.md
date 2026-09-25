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
```

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

## 4. Check it

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

## Rollback

Railway keeps previous deploys; redeploy one from the service's Deployments tab.

Migrations are **not** rolled back automatically. Write migrations so an older
version of the app still runs against the newer schema — add columns, do not
rename or drop them in the same release as the code that stops using them.
