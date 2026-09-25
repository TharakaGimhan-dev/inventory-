# Web app

Mobile-first PWA for the asset register. Successor to the Firebase app's
`app/(auth)` and `app/(app)` shell, now talking to the NestJS API.

## Running

The API must be running first (`apps/api`, port 3001).

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

http://localhost:3000

## Why requests go through a proxy

`next.config.mjs` rewrites `/api/v1/*` to the API service.

The API returns its tokens as httpOnly cookies. On Railway the web and api
services have different hostnames, which makes every browser call cross-site,
and a `SameSite=Lax` cookie is not sent cross-site. The two usual workarounds are
both worse: `SameSite=None` widens CSRF exposure, and putting tokens in
`localStorage` puts them where injected script can read them.

Proxying keeps the browser on one origin, so httpOnly + Lax keeps working and no
token is ever readable from JavaScript.

`API_URL` is therefore server-side only and must **not** get a `NEXT_PUBLIC_`
prefix.

## Offline capture

Firestore gave the old app offline persistence for free. This replaces it, and
deliberately covers less: only captures are queued. Reads fail offline, which is
honest — a stale register reads as fact and is worse than a visibly unavailable
one.

Each queued capture carries an idempotency key generated when it was written.
The API stores the response against that key for 24 hours, so a replay returns
the original asset instead of creating a second one. Without that, a phone that
loses signal mid-capture and retries would produce a duplicate that has
permanently consumed a second asset code.

Asset codes are issued by the server, so an offline capture shows **Pending**
until it syncs. Codes must stay gapless and unreusable, and a phone cannot
promise either.

## End-to-end test

With the API and the web app both running, and a user that can sign in:

```bash
npm run test:e2e
```

Drives a real browser through the auth guard, sign-in, an online capture, sticky
fields, an offline capture into IndexedDB, the flush on reconnect, and sign-out —
and asserts the offline capture arrives exactly once.
