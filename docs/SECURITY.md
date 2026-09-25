# Security

Reviewed against the [OWASP Top 10:2025](https://top10.owasp.org/2025/) on
2026-09-25. This document records what is defended, how, and — importantly —
what is **not** yet defended.

## Status against OWASP Top 10:2025

| | Category | State |
|---|---|---|
| A01 | Broken Access Control | **Defended.** Three-layer tenant isolation, ranked roles, 30 tests |
| A02 | Security Misconfiguration | **Defended.** helmet on the API, full header set + CSP on the web app, Swagger closed in production, `synchronize` off |
| A03 | Software Supply Chain Failures | **Defended.** 0 vulnerabilities in both apps; CI runs on every push |
| A04 | Cryptographic Failures | **Defended.** bcrypt cost 12, SHA-256 API keys, HS256 pinned, httpOnly + Secure + SameSite cookies |
| A05 | Injection | **Defended.** Every query parameterised or through Sequelize; Zod strips unknown keys; CSV formula injection neutralised |
| A06 | Insecure Design | **Partly.** Limits enforced at the write, not the check. Email verification is **not** enforced — see Open items |
| A07 | Authentication Failures | **Defended.** Rate limits, per-account lockout, session revocation on password change |
| A08 | Software/Data Integrity Failures | **Defended.** Webhook signatures verified in constant time, exactly-once processing, append-only audit trail |
| A09 | Security Logging & Alerting Failures | **Partly.** Failed logins and lockouts are logged. There is no **alerting** — see Open items |
| A10 | Mishandling of Exceptional Conditions | **Defended.** Fails closed on tenant context; explicit body limits; rate limiting fails open, deliberately and loudly |

## What defends what

### Authentication (A07)

Before this review, forty wrong passwords in ten seconds were all answered,
none were recorded, and nothing slowed down.

Two independent layers, because each covers the other's blind spot:

- **Rate limit, per caller address.** 10 login attempts a minute, 5 signups an
  hour, 300 requests a minute otherwise. A person mistypes two or three times,
  never ten.
- **Account lockout, per account.** 8 failures in 15 minutes locks the account
  for 15 minutes. Rate limiting alone is keyed on the address, so an attacker
  with a few hundred addresses gets a few hundred budgets against one account;
  this defence follows the thing being attacked.

Counters live in **Redis, not in the process**. The default in-memory storage is
correct for one replica and wrong the moment the API is scaled — three replicas
would each keep their own count, turning a limit of ten into thirty.

Changing a password sets `users.tokensValidFrom` and deletes every refresh
session. An access token minted before that instant is refused even if it has
not expired, so the one thing a person knows to do about a stolen session
actually ends it.

### Tokens (A04)

- Access 15 minutes, refresh 30 days, separate secrets, **HS256 pinned**. Left
  unpinned, a verifier accepts whatever algorithm the token's own header names.
- httpOnly + SameSite=Lax cookies, `Secure` in production. No token is ever
  readable from JavaScript, which the browser tests assert.
- Redis is the source of truth for live sessions, so a signed but revoked token
  stops working. Refresh rotates the session id, so a leaked refresh token
  cannot be replayed after the real user has used it.

### The web app (A02)

`next.config.mjs` sends a full header set. The CSP matters most: this app holds
an authenticated session, so the damage an injected script could do is bounded
by where it is allowed to send what it reads. `connect-src 'self'` means
nowhere.

`script-src` still carries `'unsafe-inline'`, required by Next's own bootstrap.
Removing it needs a nonce threaded through the render path — worth doing, not
worth slipping into a security pass.

### Infrastructure (A09, A10)

`trust proxy` is set to exactly **1**. Without it, every request behind
Railway's edge appears to come from the proxy: one shared rate-limit bucket for
the whole internet, and the proxy's address on every audit entry. Trusting *all*
hops would instead let a caller forge the header and mint a fresh bucket per
request.

Body limits are explicit — 256 KB by default, 6 MB on the import route, 64 KB on
the webhook. Express defaults to 100 KB, which silently answered 413 to an
import the route's own schema said could be 5 MB.

## Open items

These are known and unfixed. They are listed because an undocumented gap is
worse than a documented one.

| # | Gap | Risk | Suggested |
|---|---|---|---|
| 1 | **Email verification is not enforced.** `users.emailVerified` exists and nothing reads it. Signup is open, so anyone can create a tenant with an address they do not own. | Spam tenants; a password reset sent to an unverified address | Before launch |
| 2 | **No password reset flow.** A locked-out user has no self-service route back in. | Support burden; users choosing weak memorable passwords | Before launch |
| 3 | **No alerting.** Lockouts and signature failures are logged; nobody is told. | An attack is visible only to whoever reads the logs | Before launch |
| 4 | **PayHere signature formula unverified** against a live merchant account. | Wrong in the lenient direction, anyone who can POST to the notify URL marks a subscription paid | Before taking money |
| 5 | **No MFA.** | An owner's password is the only thing protecting billing | Post-launch |
| 6 | **No breached-password check.** Minimum is 10 characters with no other test. | Credential stuffing against reused passwords | Post-launch |
| 7 | **Rate limiting fails open** if Redis is down. Deliberate — the alternative locks every customer out of a tool they are standing in a store room using — but it is a real window. | Brute force during a cache outage | Monitor Redis |
| 8 | **No automated dependency scanning on a schedule.** CI audits on push; a vulnerability published on a quiet week is not noticed. | Stale advisory | Add Dependabot |

## Running a review

```bash
cd apps/api && npm audit --omit=dev && npm run test:isolation
cd apps/web && npm audit --omit=dev
```

Header check against a running web app:

```bash
curl -sI http://localhost:3000/login | grep -iE 'content-security|x-frame|strict-transport'
```

## Reporting

Security issues: **tgimhan304@gmail.com**. Please do not open a public issue.
