# ADR-004: Stateless access tokens with rotating refresh tokens

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** Project maintainer

## Context

The API is consumed by a browser client in the same origin (through the Vite
proxy in development and nginx in production) and should stay usable behind a
load balancer without sticky sessions.

Two failure modes matter:

1. A stolen long-lived token is usable for weeks.
2. A stolen refresh token can be replayed forever if rotation is not detected.

Cookie-based sessions alone would require a shared session store; pure JWTs with
no server state cannot be revoked.

## Decision

- **Access tokens** are short-lived (15 minutes) HS256 JWTs signed by the API,
  sent in the `Authorization: Bearer` header. They are never stored server-side.
- **Refresh tokens** are opaque 256-bit random values sent in an `httpOnly`,
  `SameSite=Strict` cookie scoped to `/api/v1/auth`.
- Only the **SHA-256 hash** of a refresh token is stored.
- Refresh tokens are **rotated on every use** and grouped into a `family_id`.
  Presenting an already-used token revokes the whole family.
- Passwords are hashed with **Argon2id** using OWASP's recommended parameters.

## Alternatives considered

**Server-side sessions with a session table.** Simple to revoke, but every
authenticated request becomes a database round trip, and a shared session store
becomes another component to operate.

**Long-lived JWTs without refresh.** No database lookups, but revocation is
impossible until expiry. Unacceptable for a product holding financial data.

**Refresh token without rotation.** Standard practice in older tutorials, but it
turns one leaked token into permanent access. Rotation with reuse detection is
the only version that surfaces theft.

**`localStorage` for tokens.** Any XSS becomes full account takeover, and the
token survives a logout. The refresh cookie is `httpOnly` precisely so injected
JavaScript cannot read it.

## Consequences

- Every authenticated request costs one signature verification, not a query.
- Logging out revokes the refresh token; a stolen access token remains valid for
  at most its remaining TTL. Fifteen minutes is the accepted window.
- Reuse detection logs the attacker and the victim out rather than silently
  continuing — the correct trade-off for financial data.
- The API needs a `JWT_SECRET` of at least 32 bytes and must never share it
  between environments. Rotating it invalidates all access tokens, which is
  desirable on suspected compromise.
- CSRF exposure is limited by `SameSite=Strict` plus the fact that state-changing
  requests require a bearer token the browser does not attach automatically.

## Implementation notes

- `apps/api/src/lib/tokens.ts` — signing, verification, opaque refresh tokens.
- `apps/api/src/lib/password.ts` — Argon2id parameters, fixed for every
  environment so a weaker development hash cannot reach production.
- `apps/api/src/modules/auth/repository.ts` — `claimRefreshToken` performs a
  conditional `UPDATE ... WHERE revoked_at IS NULL`, so two concurrent refreshes
  cannot both succeed.
- Failed logins spend roughly the same time as successful ones (a hash is
  computed either way) so response timing does not disclose account existence.
