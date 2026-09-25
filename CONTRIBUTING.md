# Contributing

## Before anything else

Read [`SAAS_SPEC.md`](SAAS_SPEC.md). It is the source of truth, and it records
*why* decisions were made, not only what they were. If a change contradicts it,
update the spec in the same commit — a spec that quietly falls out of date is
worse than none.

## Conventions

**Module shape.** `models/` → `schemas/` → `service/` → `controller/`. A new
feature adds a folder under `src/modules/`, not a new pattern.

**Validation** is Zod, shared between the web form and the API write path so the
two cannot disagree. Bind the pipe to `@Body`, never with `@UsePipes` at method
level — a method-level pipe runs against *every* parameter, including
`@CurrentUser()`, and quietly strips it.

**Money** is `DECIMAL` and travels as a string. A binary float loses cents, and
these columns end up in an insurance valuation.

**Comments** explain why, not what. `// increment the counter` above
`counter++` is noise; the reason the increment is one statement is not.

## Rules that must not be broken

These are not style preferences. Each one has a test, and each one exists
because breaking it costs real money or real trust.

**Never turn on `synchronize`.** It drops columns it does not recognise.

**Never add a bare `UNIQUE (code)`.** Every unique constraint on a tenant-owned
table is composite with `tenantId`, or two customers can never both own
`TS-0001`.

**Never reuse or rewind an asset code.** It is printed on a label stuck to
equipment.

**Never add a write route for audit entries.** Not for any role. If a record is
wrong, write a correcting entry.

**Never enforce a limit with a read followed by a write.** Carry the condition on
the write itself. A check-then-act guard lets concurrent requests past, and this
has already happened once.

**Never disable export.** Whatever the subscription state, a customer can get
their data out.

**Never give a secret a `NEXT_PUBLIC_` prefix.** That prefix ships it to the
browser.

**Never trust a `tenantId` from a request.** It comes from the verified token.

## Adding a tenant-owned table

1. Extend `TenantScopedModel` — that is what makes the query hook cover it.
2. Declare `tenantId` explicitly on the model and in the migration.
3. Make every unique index composite with `tenantId`.
4. If it is metered, backfill its usage counter in the migration.
5. Add a case to `tests/isolation/tenant-isolation.spec.ts`.

## Testing

See [`docs/TESTING.md`](docs/TESTING.md). Run the build and the isolation suite
before pushing.

## Commits

Explain the reasoning, not just the change. A commit that says *why* the counter
became one statement saves the next person from turning it back into two.
