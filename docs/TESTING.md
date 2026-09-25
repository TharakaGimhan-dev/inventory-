# Testing

Everything runs against a real Postgres and a real Redis. There are no mocks for
the database, on purpose: the guarantees worth testing here are properties of
Sequelize hooks, Postgres constraints and transaction boundaries, and a mock
proves none of them.

## API suites

```bash
cd apps/api
npm run test:isolation
```

Needs `DATABASE_URL` pointing at a database you do not mind being dropped — the
suites `sync({ force: true })`.

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5432/inventory_test npm run test:isolation
```

| Suite | Protects |
|---|---|
| `tenant-isolation.spec.ts` | One tenant can never read, write or detect another's data |
| `asset-register.spec.ts` | Asset codes are unique, gapless and never reused; audit entries are append-only |
| `quota.spec.ts` | Usage counters stay accurate under concurrency and rollback; plan limits hold at the boundary |

40 tests. Each of them exists because the property it checks is one a future
change could plausibly break without any other test noticing.

### What the isolation suite actually asserts

- A tenant reads only its own rows, and another tenant's id returns null — not
  a 403, which would confirm the row exists.
- A client-supplied `tenantId` on create is rejected, and a create without one
  is stamped from the request context.
- Two tenants can both hold asset code `TS-0001`.
- A query with **no** tenant in context throws rather than returning every row.
  This is the one that matters most: if it ever returns rows, every customer's
  data is one forgotten wrapper away from being served to anyone.
- `count`, `update` and `destroy` are scoped, not just `findAll`.
- Two concurrent requests keep separate tenant stores.

## Browser checks

Needs the API and the web app both running, and a user that can sign in.

```bash
cd apps/web
npm run test:e2e          # auth, capture, offline outbox
node tests/quota-e2e.mjs  # plan screen and upgrade prompt
```

Set `PLAYWRIGHT_CHROMIUM_PATH` if the machine already has a Chromium; otherwise
Playwright uses its own.

`WEB_URL`, `E2E_EMAIL` and `E2E_PASSWORD` override the defaults.

These cover what only a browser can prove:

- The auth cookie is httpOnly and **no token reaches `localStorage`**.
- A capture made with no signal lands in IndexedDB, flushes on reconnect, and
  arrives in the register **exactly once**.
- A tenant on a full plan sees an upgrade prompt naming the limit, not a raw
  error, and the item is not saved.

Both scripts exit non-zero on failure, so they fail a CI job rather than printing
`FAIL` and passing.

## Before pushing

```bash
cd apps/api && npm run build && npm run test:isolation
cd ../web && npm run build
```

A push that turns CI red costs a cycle. One validated push beats three
speculative ones.
